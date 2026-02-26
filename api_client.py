"""
RGL Infra Tracking - API Client
Wrapper for RevGenLabs API endpoints
"""

import requests
import time
from typing import Optional
from config import BASE_URL, WORKSPACES


# Retry configuration
MAX_RETRIES = 3
RETRY_DELAY_BASE = 2  # seconds, doubles each retry


class RevGenLabsAPI:
    """API client for RevGenLabs email platform"""
    
    def __init__(self, workspace_name: str, token: str):
        self.workspace_name = workspace_name
        self.token = token
        self.base_url = BASE_URL
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
    
    def _get(self, endpoint: str, params: Optional[dict] = None) -> dict:
        """Make GET request to API with retry logic"""
        url = f"{self.base_url}{endpoint}"

        for attempt in range(MAX_RETRIES):
            try:
                response = requests.get(url, headers=self.headers, params=params, timeout=60)
                response.raise_for_status()
                return response.json()
            except requests.exceptions.Timeout as e:
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_DELAY_BASE * (2 ** attempt)
                    print(f"[{self.workspace_name}] Timeout on {endpoint}, retry {attempt + 1}/{MAX_RETRIES} in {delay}s...")
                    time.sleep(delay)
                else:
                    print(f"[{self.workspace_name}] API timeout on {endpoint} after {MAX_RETRIES} retries: {e}")
                    return {"data": []}
            except requests.exceptions.RequestException as e:
                if attempt < MAX_RETRIES - 1 and "5" in str(getattr(e.response, 'status_code', '')):
                    # Retry on 5xx errors
                    delay = RETRY_DELAY_BASE * (2 ** attempt)
                    print(f"[{self.workspace_name}] Server error, retry {attempt + 1}/{MAX_RETRIES} in {delay}s...")
                    time.sleep(delay)
                else:
                    print(f"[{self.workspace_name}] API error on {endpoint}: {e}")
                    return {"data": []}

        return {"data": []}
    
    def _get_all_pages(self, endpoint: str, params: Optional[dict] = None) -> list:
        """Fetch all pages of paginated endpoint"""
        all_data = []
        page = 1
        params = params or {}
        params["per_page"] = 100  # Request 100 items per page for speed
        
        while True:
            params["page"] = page
            response = self._get(endpoint, params)
            data = response.get("data", [])
            
            if not data:
                break
            
            all_data.extend(data)
            
            # Check if there are more pages
            meta = response.get("meta", {})
            if page >= meta.get("last_page", 1):
                break
            
            page += 1
        
        return all_data
    
    def get_sender_emails(self) -> list:
        """
        Get all sender emails (mailboxes) with their stats and tags
        
        Returns list of mailboxes with:
        - id, email, name
        - tags (containing infra type)
        - emails_sent_count, total_replied_count, bounced_count
        - interested_leads_count, total_leads_contacted_count
        """
        return self._get_all_pages("/api/sender-emails")
    
    def get_campaigns(self) -> list:
        """
        Get all campaigns with their stats
        
        Returns list of campaigns with:
        - id, name, status
        - emails_sent, replied, bounced, interested
        - total_leads_contacted
        """
        return self._get_all_pages("/api/campaigns")
    
    def get_workspace_stats(self, start_date: str, end_date: str) -> dict:
        """
        Get aggregated workspace stats for date range
        
        Args:
            start_date: YYYY-MM-DD format
            end_date: YYYY-MM-DD format
        """
        params = {"start_date": start_date, "end_date": end_date}
        response = self._get("/api/workspaces/v1.1/stats", params)
        return response.get("data", {})
    
    def get_workspace_chart_stats(self, start_date: str, end_date: str) -> list:
        """
        Get daily time-series stats for workspace
        
        Args:
            start_date: YYYY-MM-DD format
            end_date: YYYY-MM-DD format
        
        Returns list of series (Sent, Replied, Interested, Bounced)
        """
        params = {"start_date": start_date, "end_date": end_date}
        response = self._get("/api/workspaces/v1.1/line-area-chart-stats", params)
        return response.get("data", [])
    
    def get_warmup_status(self) -> list:
        """Get warmup status for all sender emails"""
        return self._get_all_pages("/api/warmup/sender-emails")
    
    def get_replies(self, per_page: int = 100) -> list:
        """Get all replies"""
        return self._get_all_pages("/api/replies", {"per_page": per_page})
    
    def get_leads(self, params: Optional[dict] = None) -> list:
        """
        Get all leads with their email and status
        
        Returns list of leads with:
        - id, email, first_name, last_name, company_name
        - status (contacted, replied, interested, etc.)
        - created_at, updated_at
        - campaign info
        """
        return self._get_all_pages("/api/leads", params)
    
    def get_leads_page(self, page: int = 1, per_page: int = 100, params: Optional[dict] = None) -> dict:
        """
        Get a single page of leads (for large datasets)
        
        Returns dict with data and meta for pagination
        """
        request_params = params or {}
        request_params["page"] = page
        request_params["per_page"] = per_page
        return self._get("/api/leads", request_params)
    
    def get_sender_email_stats(self, sender_email_ids: list, start_date: str, end_date: str) -> dict:
        """
        Get time-filtered stats for specific sender emails
        
        Args:
            sender_email_ids: List of sender email IDs
            start_date: YYYY-MM-DD format
            end_date: YYYY-MM-DD format
        
        Returns dict with aggregated stats: {sent, replied, bounced, interested, ...}
        """
        if not sender_email_ids:
            return {"sent": 0, "replied": 0, "bounced": 0, "interested": 0, "unsubscribed": 0}
        
        # Build query params with multiple sender_email_ids
        params = {"start_date": start_date, "end_date": end_date}
        
        # Process in batches of 100 to avoid URL length limits
        batch_size = 100
        totals = {"Sent": 0, "Replied": 0, "Bounced": 0, "Interested": 0, "Unsubscribed": 0}
        
        for i in range(0, len(sender_email_ids), batch_size):
            batch = sender_email_ids[i:i + batch_size]
            batch_params = params.copy()
            
            # Build URL with array params
            url = "/api/campaign-events/stats"
            query_parts = [f"start_date={start_date}", f"end_date={end_date}"]
            for sid in batch:
                query_parts.append(f"sender_email_ids[]={sid}")
            
            full_url = f"{url}?{'&'.join(query_parts)}"
            response = self._get(full_url)
            
            # Sum up daily values for each metric
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
            "unsubscribed": totals["Unsubscribed"],
        }

    def get_sender_email_stats_daily(self, sender_email_ids: list, start_date: str, end_date: str) -> dict:
        """
        Get time-filtered stats for specific sender emails with DAILY breakdown

        Args:
            sender_email_ids: List of sender email IDs
            start_date: YYYY-MM-DD format
            end_date: YYYY-MM-DD format

        Returns dict of date -> {sent, replied, bounced, interested} for each day
        """
        if not sender_email_ids:
            return {}

        # Process in batches of 100 to avoid URL length limits
        batch_size = 100
        daily_totals = {}  # date -> {Sent, Replied, ...}

        for i in range(0, len(sender_email_ids), batch_size):
            batch = sender_email_ids[i:i + batch_size]

            # Build URL with array params
            url = "/api/campaign-events/stats"
            query_parts = [f"start_date={start_date}", f"end_date={end_date}"]
            for sid in batch:
                query_parts.append(f"sender_email_ids[]={sid}")

            full_url = f"{url}?{'&'.join(query_parts)}"
            response = self._get(full_url)

            # Extract daily values for each metric
            for series in response.get("data", []):
                label = series.get("label", "")
                if label not in ["Sent", "Replied", "Bounced", "Interested", "Unsubscribed"]:
                    continue

                for date_str, value in series.get("dates", []):
                    if date_str not in daily_totals:
                        daily_totals[date_str] = {"Sent": 0, "Replied": 0, "Bounced": 0, "Interested": 0, "Unsubscribed": 0}
                    daily_totals[date_str][label] += value

        # Convert to lowercase keys
        result = {}
        for date_str, stats in daily_totals.items():
            result[date_str] = {
                "sent": stats["Sent"],
                "replied": stats["Replied"],
                "bounced": stats["Bounced"],
                "interested": stats["Interested"],
            }

        return result


def get_all_workspace_clients() -> dict[str, RevGenLabsAPI]:
    """
    Create API clients for all configured workspaces.

    Tries to fetch from Supabase workspaces table first (dynamic).
    Falls back to config.py WORKSPACES dict if Supabase fails.

    Returns dict of workspace_name -> API client
    """
    # Try Supabase first for dynamic workspace management
    supabase_workspaces = _fetch_workspaces_from_supabase()
    if supabase_workspaces:
        clients = {}
        for name, token in supabase_workspaces.items():
            clients[name] = RevGenLabsAPI(name, token)
        print(f"[Workspaces] Loaded {len(clients)} active workspaces from Supabase")
        return clients

    # Fallback to config.py
    print("[Workspaces] Supabase unavailable, falling back to config.py")
    clients = {}
    for name, token in WORKSPACES.items():
        clients[name] = RevGenLabsAPI(name, token)
    return clients


def _fetch_workspaces_from_supabase() -> dict:
    """
    Fetch active workspaces from Supabase workspace_configs table.

    Returns dict of {name: api_token} or empty dict on failure.
    """
    import os
    supabase_url = "https://fxxjfgfnrywffjmxoadl.supabase.co"
    supabase_key = os.environ.get(
        "SUPABASE_SERVICE_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4eGpmZ2Zucnl3ZmZqbXhvYWRsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzYxODgzNSwiZXhwIjoyMDc5MTk0ODM1fQ.HC6BAA1601fSRS2X9Uv53rPD613xxUEcWeODU0kfJLY"
    )

    try:
        url = f"{supabase_url}/rest/v1/workspace_configs?is_active=eq.true&select=name,api_token"
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Accept": "application/json",
        }
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()

        if not data:
            return {}

        return {row["name"]: row["api_token"] for row in data}
    except Exception as e:
        print(f"[Workspaces] Failed to fetch from Supabase: {e}")
        return {}


# Quick test
if __name__ == "__main__":
    # Test with one workspace
    test_workspace = "Reev"
    token = WORKSPACES[test_workspace]
    
    client = RevGenLabsAPI(test_workspace, token)
    
    print(f"Testing API for {test_workspace}...")
    
    # Test sender emails
    sender_emails = client.get_sender_emails()
    print(f"  Sender emails: {len(sender_emails)}")
    
    if sender_emails:
        sample = sender_emails[0]
        print(f"  Sample: {sample.get('email')} - Tags: {[t.get('name') for t in sample.get('tags', [])]}")
    
    # Test campaigns
    campaigns = client.get_campaigns()
    print(f"  Campaigns: {len(campaigns)}")
