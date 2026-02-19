"""
Vercel Serverless Function: Aggregate Domain Metrics
Endpoint: /api/aggregate_domains

Triggers domain aggregation from Infrastructure_dashboard to domain_daily_metrics
Can be called by n8n or Vercel cron
"""

from http.server import BaseHTTPRequestHandler
import json
import os
import requests
from datetime import date
from collections import defaultdict

# Supabase configuration
SUPABASE_URL = "https://fxxjfgfnrywffjmxoadl.supabase.co"
SUPABASE_SERVICE_KEY = os.environ.get(
    "SUPABASE_SERVICE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4eGpmZ2Zucnl3ZmZqbXhvYWRsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzYxODgzNSwiZXhwIjoyMDc5MTk0ODM1fQ.HC6BAA1601fSRS2X9Uv53rPD613xxUEcWeODU0kfJLY"
)

HEADERS = {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}


def fetch_infrastructure_dashboard():
    """Fetch all mailbox data from Infrastructure_dashboard table"""
    url = f"{SUPABASE_URL}/rest/v1/Infrastructure_dashboard"
    params = {
        "select": "Mailbox,Domain,Client,Tag,Email Sent,Reply Count,Bounce Count,interested_response"
    }
    response = requests.get(url, headers=HEADERS, params=params)
    response.raise_for_status()
    return response.json()


def extract_tld(domain: str) -> str:
    """Extract TLD from domain"""
    if not domain:
        return "unknown"
    parts = domain.split(".")
    return parts[-1] if parts else "unknown"


def aggregate_by_domain(mailboxes: list) -> list:
    """Aggregate mailbox data by domain + client"""
    domain_data = defaultdict(lambda: {
        "mailbox_count": 0,
        "emails_sent": 0,
        "replies": 0,
        "bounces": 0,
        "interested": 0,
        "infra_type": None,
        "tld": None
    })

    for mailbox in mailboxes:
        domain = mailbox.get("Domain", "").lower().strip()
        client = mailbox.get("Client", "Unknown")

        if not domain:
            continue

        key = (domain, client)
        domain_data[key]["mailbox_count"] += 1
        domain_data[key]["emails_sent"] += mailbox.get("Email Sent", 0) or 0
        domain_data[key]["replies"] += mailbox.get("Reply Count", 0) or 0
        domain_data[key]["bounces"] += mailbox.get("Bounce Count", 0) or 0
        domain_data[key]["interested"] += mailbox.get("interested_response", 0) or 0

        if not domain_data[key]["infra_type"]:
            domain_data[key]["infra_type"] = mailbox.get("Tag", "Unknown")
        if not domain_data[key]["tld"]:
            domain_data[key]["tld"] = extract_tld(domain)

    today = date.today().isoformat()
    records = []

    for (domain, client), data in domain_data.items():
        sent = data["emails_sent"]
        reply_rate = round(data["replies"] / sent * 100, 4) if sent > 0 else 0
        bounce_rate = round(data["bounces"] / sent * 100, 4) if sent > 0 else 0

        records.append({
            "date": today,
            "domain": domain,
            "client_name": client,
            "infra_type": data["infra_type"] or "Unknown",
            "tld": data["tld"],
            "mailbox_count": data["mailbox_count"],
            "emails_sent": data["emails_sent"],
            "replies": data["replies"],
            "bounces": data["bounces"],
            "interested": data["interested"],
            "reply_rate": reply_rate,
            "bounce_rate": bounce_rate
        })

    return records


def upsert_domain_metrics(records: list) -> dict:
    """Upsert domain metrics into Supabase"""
    if not records:
        return {"inserted": 0, "message": "No records to insert"}

    url = f"{SUPABASE_URL}/rest/v1/domain_daily_metrics"
    batch_size = 100
    total_inserted = 0

    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        response = requests.post(url, headers=HEADERS, json=batch)
        if response.status_code in [200, 201]:
            total_inserted += len(batch)

    return {
        "inserted": total_inserted,
        "total_domains": len(records),
        "date": date.today().isoformat()
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            # Run aggregation
            mailboxes = fetch_infrastructure_dashboard()
            domain_records = aggregate_by_domain(mailboxes)
            result = upsert_domain_metrics(domain_records)

            # Add summary
            result["mailboxes_processed"] = len(mailboxes)
            result["status"] = "success"

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())

        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "error",
                "message": str(e)
            }).encode())

    def do_POST(self):
        # Also support POST for n8n webhooks
        self.do_GET()
