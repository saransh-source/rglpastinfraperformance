"""
RGL Infra Tracking - Data Verification Script
Fetches all data including Epan, verifies calculations, compares with existing data.json
Does NOT modify the existing data.json file

Run from native terminal: python3 verify_data.py
"""

import json
import os
import sys
from datetime import datetime, timedelta
from collections import defaultdict
import requests
from typing import Optional

# Force unbuffered output
sys.stdout.reconfigure(line_buffering=True)

# ============================================================================
# CONFIGURATION - Extended to include Epan
# ============================================================================

BASE_URL = "https://mail.revgenlabs.com"

WORKSPACES = {
    "Reev": "70|oN8Dzz23OuBeaNZmxkgWoGFd1uNHxXnwPHxjvIWdce260302",
    "SQA": "92|1kk1GJzDKos99Rw1N90DOnvzj4JP9AZTURjEpM8mcc358f7b",
    "Baton": "29|eVEGpeOSUQ1LJiBVfe5E3Qa9bculFxHhq70UIKzYfc81d9d8",
    "Loop Global": "34|jjKsti7eg9uRNP8et1JF4GzH5nF32lF6TCd5JYADa3816238",
    "Loop Volta": "154|dryoXqTOmFu8EatT7JF31FeIqy4Gw7fodYKikLwe",
    "Voyageur": "94|GEY5u70fx37I2njkChbrxp1Ng7mOpugHd5BcUGz4cfc2a560",
    "Mobius": "136|u5U0SpOi4k60oTfTOvAfqF06Pg70BKIFi6Xj2XLy23e28d58",
    "Big Think": "137|BmF6vLkIwq5ulcSfB0h326KNTHM6WzSDecMnbCqs0c6428f1",
    "Kodem": "126|RW8l3aAWlNy0SV31aARsFuDM7YLcm3a2Y2YmMfQoe619ab58",
    "Keep Company": "134|S2Y7bQvN7bIqGQSUwkzHFbj0BVpdj0g7eGJn5t6dffb3127c",
    "Elemental TV": "125|TusTryCjoaxv4mdilfBCIvGEL300clQy9IL5cbUg952e7484",
    "RGL Amir": "106|NSUddH0YLOVJgL44gl9lZ8jSLm1okkiAKQirE59tad4b5f9e",
    "RGL Vera": "145|6Zh6OQhT8aPTuYKIVnntGDQS6u5g3FS0hA93cXS0fcedb8e1",
    "RGL Mitul": "146|bTa2Mg8YRlXpuKtGV87LuQpTY60hTEdMKya9H2DK35afe21b",
    "RGL Kim": "147|YJQW8JWL4Omt5DjBvvMKp4zSgGY8Fmq4zlSe8lxR770eb082",
    "RGL Rahul": "148|I4t7TXTDwLtqasedrH0CXnnAaYCwidPMRvDIAee51a1fb410",
    "RGL Saransh": "149|sylx7dHO3D1oDKSBtM82udP2wZ8sc6AnCjW0RSaNffe2219b",
    "Select Hub": "172|9lGjZdMKZMMe6ntgIHgleRCQ5BJ0nSZ1lJwkdDp8ee6f8af7",
    "Hey Reach": "173|eei0yQznrWHWMuZxXLtEYnnATU1JEjiN29N3Banha104a49e",
    "Onramp": "179|uF36yPIzQGvz4BtEQOg4Zkw6Mrhm3UIHkp03amHKc2fe99a6",
}

# Extended tag mapping INCLUDING Epan
TAG_TO_INFRA_EXTENDED = {
    "GR": "Google Reseller",
    "AO": "Aged Outlook", 
    "L": "Legacy Panel",
    "MD SMTP": "Maldoso",
    "Outlook": "Outlook",
    "WR SMTP": "Winnr SMTP",
    "winnr SMTP": "Winnr SMTP",
    "E": "Epan",  # Added for verification
    "e": "Epan",
}

# All infra types we want to verify (including Epan)
VERIFY_INFRA_TYPES = [
    "Google Reseller",
    "Aged Outlook",
    "Legacy Panel", 
    "Maldoso",
    "Outlook",
    "Winnr SMTP",
    "Epan",  # Added
]

# Original tracked types (without Epan)
ORIGINAL_TRACKED_TYPES = [
    "Google Reseller",
    "Aged Outlook",
    "Legacy Panel", 
    "Maldoso",
    "Outlook",
    "Winnr SMTP",
]

TIME_PERIODS = {
    "3d": 3,
    "7d": 7,
    "14d": 14,
    "30d": 30,
}

INFRA_MAX_LIMITS = {
    "Aged Outlook": 10,
    "Outlook": 10,
    "Google Reseller": 20,
    "Maldoso": 15,
    "Legacy Panel": 2,
    "Winnr SMTP": 10,
    "Epan": 10,  # Assumed same as other edu panels
}


# ============================================================================
# API CLIENT
# ============================================================================

class VerifyAPIClient:
    """Minimal API client for verification"""
    
    def __init__(self, workspace_name: str, token: str):
        self.workspace_name = workspace_name
        self.token = token
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
    
    def _get(self, endpoint: str, params: Optional[dict] = None) -> dict:
        url = f"{BASE_URL}{endpoint}"
        try:
            response = requests.get(url, headers=self.headers, params=params, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            return {"data": [], "error": str(e)}
    
    def _get_all_pages(self, endpoint: str) -> list:
        all_data = []
        page = 1
        while True:
            response = self._get(endpoint, {"page": page, "per_page": 100})
            data = response.get("data", [])
            if not data:
                break
            all_data.extend(data)
            meta = response.get("meta", {})
            if page >= meta.get("last_page", 1):
                break
            page += 1
        return all_data
    
    def get_sender_emails(self) -> list:
        return self._get_all_pages("/api/sender-emails")
    
    def get_warmup_status(self) -> list:
        return self._get_all_pages("/api/warmup/sender-emails")
    
    def get_sender_email_stats(self, sender_email_ids: list, start_date: str, end_date: str) -> dict:
        if not sender_email_ids:
            return {"sent": 0, "replied": 0, "bounced": 0, "interested": 0}
        
        totals = {"Sent": 0, "Replied": 0, "Bounced": 0, "Interested": 0}
        batch_size = 100
        
        for i in range(0, len(sender_email_ids), batch_size):
            batch = sender_email_ids[i:i + batch_size]
            query_parts = [f"start_date={start_date}", f"end_date={end_date}"]
            for sid in batch:
                query_parts.append(f"sender_email_ids[]={sid}")
            
            full_url = f"/api/campaign-events/stats?{'&'.join(query_parts)}"
            response = self._get(full_url)
            
            for series in response.get("data", []):
                label = series.get("label", "")
                if label in totals:
                    for _, value in series.get("dates", []):
                        totals[label] += value
        
        return {
            "sent": totals["Sent"],
            "replied": totals["Replied"],
            "bounced": totals["Bounced"],
            "interested": totals["Interested"],
        }


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_infra_from_tags(tags: list) -> str:
    """Get infra type from tags, including Epan"""
    if not tags:
        return None
    for tag in tags:
        tag_name = tag.get("name", "")
        if tag_name in TAG_TO_INFRA_EXTENDED:
            return TAG_TO_INFRA_EXTENDED[tag_name]
    return None

def extract_domain(email: str) -> str:
    if not email or "@" not in email:
        return ""
    return email.split("@")[1].lower()

def extract_tld(domain: str) -> str:
    if not domain or "." not in domain:
        return ""
    return "." + domain.split(".")[-1].lower()

def get_date_range(period: str) -> tuple:
    days = TIME_PERIODS.get(period, 30)
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    return start_date.strftime("%Y-%m-%d"), end_date.strftime("%Y-%m-%d"), days

def calculate_metrics(sent: int, replied: int, interested: int, bounced: int, 
                      mailboxes: int, num_days: int) -> dict:
    """Calculate derived metrics"""
    metrics = {}
    
    if sent > 0:
        metrics["reply_rate"] = round(replied / sent * 100, 2)
        metrics["positive_rate"] = round(interested / sent * 100, 3)
        metrics["bounce_rate"] = round(bounced / sent * 100, 2)
        metrics["positive_per_1k"] = round(interested / sent * 1000, 2)
    else:
        metrics["reply_rate"] = 0
        metrics["positive_rate"] = 0
        metrics["bounce_rate"] = 0
        metrics["positive_per_1k"] = 0
    
    if replied > 0:
        metrics["positive_reply_rate"] = round(interested / replied * 100, 2)
    else:
        metrics["positive_reply_rate"] = 0
    
    if mailboxes > 0 and num_days > 0:
        metrics["avg_sends_per_mailbox_per_day"] = round(sent / mailboxes / num_days, 2)
    else:
        metrics["avg_sends_per_mailbox_per_day"] = 0
    
    if num_days > 0:
        metrics["positives_per_day"] = round(interested / num_days, 2)
    else:
        metrics["positives_per_day"] = 0
    
    return metrics


# ============================================================================
# MAIN VERIFICATION LOGIC
# ============================================================================

def print_separator(title: str = ""):
    print("\n" + "=" * 70)
    if title:
        print(f" {title}")
        print("=" * 70)

def verify_calculation(label: str, numerator: float, denominator: float, 
                       expected: float, multiplier: float = 100, decimals: int = 2) -> bool:
    """Verify a single calculation and print result"""
    if denominator > 0:
        calculated = round((numerator / denominator) * multiplier, decimals)
    else:
        calculated = 0
    
    match = abs(calculated - expected) < 0.01
    status = "✓" if match else "✗"
    print(f"    {label}: {numerator}/{denominator} × {multiplier} = {calculated} (expected {expected}) {status}")
    return match


def main():
    output_lines = []
    
    def log(msg: str):
        print(msg)
        output_lines.append(msg)
    
    log("=" * 70)
    log("RGL INFRA TRACKING - DATA VERIFICATION")
    log(f"Generated at: {datetime.now().isoformat()}")
    log("=" * 70)
    
    # ========================================================================
    # STEP 1: Show Date Ranges
    # ========================================================================
    print_separator("STEP 1: DATE RANGES FOR EACH PERIOD")
    
    for period_key, days in TIME_PERIODS.items():
        start, end, _ = get_date_range(period_key)
        log(f"  {period_key.upper():>4} ({days:2} days): {start} to {end}")
    
    # ========================================================================
    # STEP 2: Fetch All Mailboxes (Including Epan)
    # ========================================================================
    print_separator("STEP 2: FETCHING ALL MAILBOXES")
    
    all_mailboxes = {}  # infra_type -> list of mailbox info
    all_workspace_mailboxes = {}  # workspace -> infra_type -> list of mailbox info
    all_tags_found = set()
    warmup_data = {}
    clients = {}
    
    sample_raw_responses = []  # For verification
    
    for infra in VERIFY_INFRA_TYPES:
        all_mailboxes[infra] = []
        
    for workspace_name, token in WORKSPACES.items():
        print(f"  {workspace_name}...", end=" ", flush=True)
        client = VerifyAPIClient(workspace_name, token)
        clients[workspace_name] = client
        
        try:
            mailboxes = client.get_sender_emails()
            warmup_list = client.get_warmup_status()
            warmup_data[workspace_name] = warmup_list
            
            # Save first sample for verification
            if len(sample_raw_responses) < 3 and mailboxes:
                sample_raw_responses.append({
                    "workspace": workspace_name,
                    "sample_mailbox": mailboxes[0]
                })
            
            all_workspace_mailboxes[workspace_name] = {}
            for infra in VERIFY_INFRA_TYPES:
                all_workspace_mailboxes[workspace_name][infra] = []
            
            tracked_count = 0
            for mb in mailboxes:
                # Collect all tags
                for tag in mb.get("tags", []):
                    all_tags_found.add(tag.get("name", ""))
                
                infra_type = get_infra_from_tags(mb.get("tags", []))
                if infra_type and infra_type in VERIFY_INFRA_TYPES:
                    domain = extract_domain(mb.get("email", ""))
                    mb_info = {
                        "id": mb["id"],
                        "email": mb.get("email", ""),
                        "domain": domain,
                        "tld": extract_tld(domain),
                        "workspace": workspace_name,
                        "daily_limit": mb.get("daily_limit", 0),
                        "status": mb.get("status", ""),
                        "infra_type": infra_type,
                    }
                    all_mailboxes[infra_type].append(mb_info)
                    all_workspace_mailboxes[workspace_name][infra_type].append(mb_info)
                    tracked_count += 1
            
            print(f"✓ {tracked_count}/{len(mailboxes)} tracked")
            log(f"  {workspace_name}: ✓ {tracked_count}/{len(mailboxes)} tracked")
            
        except Exception as e:
            print(f"✗ Error: {e}")
            log(f"  {workspace_name}: ✗ Error: {e}")
    
    # ========================================================================
    # STEP 3: Show All Tags Found
    # ========================================================================
    print_separator("STEP 3: ALL UNIQUE TAGS FOUND")
    
    log(f"  Total unique tags: {len(all_tags_found)}")
    for tag in sorted(all_tags_found):
        mapped = TAG_TO_INFRA_EXTENDED.get(tag, "(not mapped)")
        log(f"    '{tag}' -> {mapped}")
    
    # ========================================================================
    # STEP 4: Show Sample Raw API Response
    # ========================================================================
    print_separator("STEP 4: SAMPLE RAW API RESPONSES")
    
    for sample in sample_raw_responses[:2]:
        log(f"\n  Workspace: {sample['workspace']}")
        mb = sample['sample_mailbox']
        log(f"    id: {mb.get('id')}")
        log(f"    email: {mb.get('email')}")
        log(f"    daily_limit: {mb.get('daily_limit')}")
        log(f"    status: {mb.get('status')}")
        log(f"    tags: {[t.get('name') for t in mb.get('tags', [])]}")
    
    # ========================================================================
    # STEP 5: Mailbox Summary per Infra
    # ========================================================================
    print_separator("STEP 5: MAILBOX SUMMARY BY INFRA TYPE")
    
    for infra_type in VERIFY_INFRA_TYPES:
        mbs = all_mailboxes[infra_type]
        domains = set(m["domain"] for m in mbs if m["domain"])
        total_capacity = sum(m.get("daily_limit", 0) for m in mbs)
        theoretical = len(mbs) * INFRA_MAX_LIMITS.get(infra_type, 10)
        
        log(f"\n  {infra_type}:")
        log(f"    Mailboxes: {len(mbs)}")
        log(f"    Domains: {len(domains)}")
        log(f"    Current Capacity (sum of daily_limit): {total_capacity}")
        log(f"    Theoretical Max ({len(mbs)} × {INFRA_MAX_LIMITS.get(infra_type, 10)}): {theoretical}")
    
    # ========================================================================
    # STEP 6: Fetch Stats and Verify Calculations for Each Period
    # ========================================================================
    
    verification_results = {}  # period -> infra -> stats
    epan_stats = {}  # period -> stats
    
    for period_key in TIME_PERIODS.keys():
        start_date, end_date, num_days = get_date_range(period_key)
        
        print_separator(f"STEP 6: VERIFYING {period_key.upper()} ({start_date} to {end_date})")
        
        verification_results[period_key] = {}
        
        for infra_type in VERIFY_INFRA_TYPES:
            mbs = all_mailboxes[infra_type]
            if not mbs:
                continue
            
            # Aggregate stats across all workspaces for this infra
            total_sent = 0
            total_replied = 0
            total_bounced = 0
            total_interested = 0
            
            log(f"\n  Fetching stats for {infra_type}...")
            
            # Group by workspace and fetch
            for workspace_name, infra_mbs in all_workspace_mailboxes.items():
                ws_mbs = infra_mbs.get(infra_type, [])
                if not ws_mbs:
                    continue
                
                client = clients.get(workspace_name)
                if not client:
                    continue
                
                mb_ids = [m["id"] for m in ws_mbs]
                
                try:
                    stats = client.get_sender_email_stats(mb_ids, start_date, end_date)
                    total_sent += stats.get("sent", 0)
                    total_replied += stats.get("replied", 0)
                    total_bounced += stats.get("bounced", 0)
                    total_interested += stats.get("interested", 0)
                except Exception as e:
                    log(f"    {workspace_name} error: {e}")
            
            domains = set(m["domain"] for m in mbs if m["domain"])
            current_capacity = sum(m.get("daily_limit", 0) for m in mbs)
            theoretical_max = len(mbs) * INFRA_MAX_LIMITS.get(infra_type, 10)
            
            # Calculate derived metrics
            metrics = calculate_metrics(
                total_sent, total_replied, total_interested, total_bounced,
                len(mbs), num_days
            )
            
            log(f"\n  {infra_type} ({period_key}):")
            log(f"    RAW VALUES:")
            log(f"      Sent: {total_sent}")
            log(f"      Replied: {total_replied}")
            log(f"      Interested: {total_interested}")
            log(f"      Bounced: {total_bounced}")
            log(f"      Mailboxes: {len(mbs)}")
            log(f"      Domains: {len(domains)}")
            
            log(f"    DERIVED CALCULATIONS:")
            log(f"      Reply Rate: {total_replied}/{total_sent} × 100 = {metrics['reply_rate']}%")
            log(f"      Positive Rate: {total_interested}/{total_sent} × 100 = {metrics['positive_rate']}%")
            log(f"      +ve Reply Rate: {total_interested}/{total_replied} × 100 = {metrics['positive_reply_rate']}%")
            log(f"      Bounce Rate: {total_bounced}/{total_sent} × 100 = {metrics['bounce_rate']}%")
            log(f"      Avg Sends/MB/Day: {total_sent}/{len(mbs)}/{num_days} = {metrics['avg_sends_per_mailbox_per_day']}")
            log(f"      Positives/Day: {total_interested}/{num_days} = {metrics['positives_per_day']}")
            
            verification_results[period_key][infra_type] = {
                "mailbox_count": len(mbs),
                "domain_count": len(domains),
                "current_capacity": current_capacity,
                "theoretical_max": theoretical_max,
                "sent": total_sent,
                "replied": total_replied,
                "bounced": total_bounced,
                "interested": total_interested,
                **metrics
            }
            
            # Save Epan stats separately
            if infra_type == "Epan":
                epan_stats[period_key] = verification_results[period_key][infra_type]
    
    # ========================================================================
    # STEP 7: Compare with Existing data.json
    # ========================================================================
    print_separator("STEP 7: COMPARING WITH EXISTING data.json")
    
    data_json_path = os.path.join(os.path.dirname(__file__), "static", "data.json")
    
    if os.path.exists(data_json_path):
        with open(data_json_path, "r") as f:
            existing_data = json.load(f)
        
        discrepancies = []
        
        for period_key in TIME_PERIODS.keys():
            log(f"\n  Period: {period_key}")
            
            existing_period = existing_data.get(period_key, {})
            existing_by_infra = existing_period.get("by_infra", {})
            
            for infra_type in ORIGINAL_TRACKED_TYPES:  # Only compare original types
                existing = existing_by_infra.get(infra_type, {})
                verified = verification_results.get(period_key, {}).get(infra_type, {})
                
                if not existing or not verified:
                    continue
                
                # Compare key fields
                fields_to_compare = ["sent", "replied", "interested", "bounced", 
                                     "mailbox_count", "domain_count"]
                
                for field in fields_to_compare:
                    ex_val = existing.get(field, 0)
                    vr_val = verified.get(field, 0)
                    
                    if ex_val != vr_val:
                        diff = vr_val - ex_val
                        discrepancies.append({
                            "period": period_key,
                            "infra": infra_type,
                            "field": field,
                            "existing": ex_val,
                            "verified": vr_val,
                            "diff": diff
                        })
                        log(f"    {infra_type}/{field}: existing={ex_val}, verified={vr_val} (diff={diff}) ✗")
                    else:
                        log(f"    {infra_type}/{field}: {vr_val} ✓")
        
        log(f"\n  Total discrepancies found: {len(discrepancies)}")
        
        if discrepancies:
            log("\n  DISCREPANCY SUMMARY:")
            for d in discrepancies[:20]:  # Show first 20
                log(f"    {d['period']}/{d['infra']}/{d['field']}: "
                    f"{d['existing']} -> {d['verified']} (diff: {d['diff']})")
    else:
        log(f"  ✗ data.json not found at {data_json_path}")
    
    # ========================================================================
    # STEP 8: Output Epan Stats
    # ========================================================================
    print_separator("STEP 8: EPAN STATISTICS")
    
    if epan_stats:
        log("\n  EPAN (E tagged mailboxes) found!")
        for period_key, stats in epan_stats.items():
            log(f"\n  {period_key.upper()}:")
            log(f"    Mailboxes: {stats.get('mailbox_count', 0)}")
            log(f"    Domains: {stats.get('domain_count', 0)}")
            log(f"    Sent: {stats.get('sent', 0)}")
            log(f"    Replied: {stats.get('replied', 0)}")
            log(f"    Interested: {stats.get('interested', 0)}")
            log(f"    Bounced: {stats.get('bounced', 0)}")
            log(f"    Reply Rate: {stats.get('reply_rate', 0)}%")
            log(f"    +ve Rate: {stats.get('positive_rate', 0)}%")
            log(f"    +ve Reply Rate: {stats.get('positive_reply_rate', 0)}%")
            log(f"    Bounce Rate: {stats.get('bounce_rate', 0)}%")
        
        # Save Epan stats to separate file
        epan_output_path = os.path.join(os.path.dirname(__file__), "epan_verification.json")
        with open(epan_output_path, "w") as f:
            json.dump(epan_stats, f, indent=2)
        log(f"\n  ✓ Epan stats saved to: {epan_output_path}")
    else:
        log("\n  No Epan (E tagged) mailboxes found in any workspace.")
    
    # ========================================================================
    # STEP 9: Summary
    # ========================================================================
    print_separator("VERIFICATION COMPLETE")
    
    log("\nDate ranges used:")
    for period_key, days in TIME_PERIODS.items():
        start, end, _ = get_date_range(period_key)
        log(f"  {period_key}: {start} to {end} ({days} days)")
    
    log("\nInfra types verified:")
    for infra in VERIFY_INFRA_TYPES:
        count = len(all_mailboxes.get(infra, []))
        log(f"  {infra}: {count} mailboxes")
    
    # Save verification output
    output_path = os.path.join(os.path.dirname(__file__), "verification_output.txt")
    with open(output_path, "w") as f:
        f.write("\n".join(output_lines))
    log(f"\n✓ Full output saved to: {output_path}")


if __name__ == "__main__":
    main()
