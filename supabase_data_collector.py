"""
RGL Infra Tracking - Supabase Data Collector
Collects data from RevGenLabs API and stores in Supabase tables

Tables:
- mailbox_snapshots: Current state per mailbox
- daily_infra_stats: Historical daily aggregates by workspace + infra
- daily_domain_stats: Domain-level daily tracking for health analysis

Reuses existing analyzer.py logic for API fetching and aggregation.
"""

import os
import requests
from datetime import datetime, timedelta
from collections import defaultdict

from config import (
    TAG_TO_INFRA, TRACKED_INFRA_TYPES, INFRA_MAX_LIMITS, WORKSPACES
)
from api_client import get_all_workspace_clients

# Supabase configuration
SUPABASE_URL = "https://fxxjfgfnrywffjmxoadl.supabase.co"
SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4eGpmZ2Zucnl3ZmZqbXhvYWRsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzYxODgzNSwiZXhwIjoyMDc5MTk0ODM1fQ.HC6BAA1601fSRS2X9Uv53rPD613xxUEcWeODU0kfJLY"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", SUPABASE_SERVICE_KEY)


def get_infra_type_from_tags(tags: list) -> str:
    """Extract infra type from mailbox tags"""
    if not tags:
        return None
    for tag in tags:
        tag_name = tag.get("name", "")
        if tag_name in TAG_TO_INFRA:
            infra_type = TAG_TO_INFRA[tag_name]
            if infra_type in TRACKED_INFRA_TYPES:
                return infra_type
    return None


def extract_domain(email: str) -> str:
    """Extract domain from email address"""
    if not email or "@" not in email:
        return ""
    return email.split("@")[1].lower()


def extract_tld(domain: str) -> str:
    """Extract TLD from domain"""
    if not domain or "." not in domain:
        return ""
    return "." + domain.split(".")[-1].lower()


def supabase_upsert(table: str, data: list, on_conflict: str = None, batch_size: int = 500) -> dict:
    """
    Upsert data to Supabase table in batches

    Args:
        table: Table name
        data: List of records to upsert
        on_conflict: Column(s) to use for conflict resolution (comma-separated)
        batch_size: Number of records per batch (default 500 to avoid payload limits)
    """
    if not data:
        return {"status": "skipped", "count": 0}

    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }

    # Add on_conflict parameter for upsert behavior
    if on_conflict:
        url += f"?on_conflict={on_conflict}"

    total_inserted = 0
    errors = []

    # Process in batches to avoid Supabase payload size limits
    for i in range(0, len(data), batch_size):
        batch = data[i:i + batch_size]
        try:
            response = requests.post(url, json=batch, headers=headers)
            response.raise_for_status()
            total_inserted += len(batch)
        except requests.exceptions.RequestException as e:
            print(f"Supabase error on {table} (batch {i//batch_size + 1}): {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"Response: {e.response.text}")
            errors.append(str(e))

    if errors:
        return {"status": "partial", "count": total_inserted, "errors": errors}
    return {"status": "success", "count": total_inserted}


def fetch_all_mailboxes_with_details() -> list:
    """
    Fetch all mailboxes from all workspaces with warmup details

    Returns list of mailbox dicts with all fields needed for mailbox_snapshots
    """
    clients = get_all_workspace_clients()
    all_mailboxes = []

    print("Fetching mailboxes from all workspaces...")

    for workspace_name, client in clients.items():
        print(f"  {workspace_name}...", end=" ", flush=True)

        try:
            # Get mailboxes
            mailboxes = client.get_sender_emails()

            # Get warmup data
            warmup_list = []
            try:
                warmup_list = client.get_warmup_status()
            except Exception as e:
                print(f"(warmup error: {e})", end=" ")

            # Build warmup lookup by ID
            warmup_by_id = {w.get("id"): w for w in warmup_list}

            tracked_count = 0
            for mb in mailboxes:
                infra_type = get_infra_type_from_tags(mb.get("tags", []))
                if not infra_type:
                    continue

                email = mb.get("email", "")
                domain = extract_domain(email)
                tld = extract_tld(domain)
                mb_id = mb.get("id")

                # Get warmup info
                warmup_info = warmup_by_id.get(mb_id, {})
                warmup_enabled = warmup_info.get("warmup_enabled", False)
                warmup_daily_limit = warmup_info.get("warmup_daily_limit", 0) if warmup_enabled else 0

                mailbox_data = {
                    "email": email,
                    "domain": domain,
                    "tld": tld,
                    "workspace_name": workspace_name,
                    "infra_type": infra_type,
                    "daily_limit": mb.get("daily_limit", 0),
                    "warmup_enabled": warmup_enabled,
                    "warmup_daily_limit": warmup_daily_limit,
                    "external_id": mb_id,
                    # These will be updated with time-filtered stats
                    "emails_sent": 0,
                    "replies": 0,
                    "bounces": 0,
                    "interested": 0,
                }

                all_mailboxes.append(mailbox_data)
                tracked_count += 1

            print(f"✓ {tracked_count}/{len(mailboxes)} tracked")

        except Exception as e:
            print(f"✗ Error: {e}")

    return all_mailboxes


def fetch_stats_for_mailboxes(mailboxes: list, days: int = 30) -> dict:
    """
    Fetch time-filtered stats for all mailboxes

    Returns dict of workspace_name -> infra_type -> {sent, replied, bounced, interested}
    """
    clients = get_all_workspace_clients()

    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    # Group mailboxes by workspace + infra
    workspace_infra_mailboxes = defaultdict(lambda: defaultdict(list))
    for mb in mailboxes:
        workspace = mb["workspace_name"]
        infra = mb["infra_type"]
        workspace_infra_mailboxes[workspace][infra].append(mb)

    stats_by_workspace_infra = defaultdict(lambda: defaultdict(dict))

    print(f"\nFetching stats for {days} days ({start_str} to {end_str})...")

    for workspace_name, infra_groups in workspace_infra_mailboxes.items():
        client = clients.get(workspace_name)
        if not client:
            continue

        for infra_type, mb_list in infra_groups.items():
            mailbox_ids = [mb["external_id"] for mb in mb_list if mb.get("external_id")]

            print(f"  {workspace_name}/{infra_type}: {len(mailbox_ids)} mailboxes...", end=" ", flush=True)

            try:
                stats = client.get_sender_email_stats(mailbox_ids, start_str, end_str)
                stats_by_workspace_infra[workspace_name][infra_type] = {
                    "sent": stats.get("sent", 0),
                    "replied": stats.get("replied", 0),
                    "bounced": stats.get("bounced", 0),
                    "interested": stats.get("interested", 0),
                    "mailbox_count": len(mb_list),
                }
                print(f"✓ sent={stats.get('sent', 0)}")
            except Exception as e:
                print(f"✗ {e}")
                stats_by_workspace_infra[workspace_name][infra_type] = {
                    "sent": 0, "replied": 0, "bounced": 0, "interested": 0,
                    "mailbox_count": len(mb_list),
                }

    return dict(stats_by_workspace_infra)


def aggregate_by_domain(mailboxes: list, stats_by_workspace_infra: dict) -> list:
    """
    Aggregate mailbox data by domain for daily_domain_stats

    Distributes stats proportionally based on mailbox count per domain
    """
    # Group mailboxes by domain + workspace
    domain_groups = defaultdict(lambda: {
        "workspace_name": None,
        "infra_type": None,
        "tld": None,
        "mailboxes": [],
    })

    for mb in mailboxes:
        key = (mb["domain"], mb["workspace_name"])
        group = domain_groups[key]
        group["workspace_name"] = mb["workspace_name"]
        group["infra_type"] = mb["infra_type"]
        group["tld"] = mb["tld"]
        group["mailboxes"].append(mb)

    domain_stats = []
    today = datetime.now().strftime("%Y-%m-%d")

    for (domain, workspace), group in domain_groups.items():
        if not domain:
            continue

        infra_type = group["infra_type"]
        workspace_name = group["workspace_name"]
        mb_count = len(group["mailboxes"])

        # Get stats for this workspace+infra
        ws_stats = stats_by_workspace_infra.get(workspace_name, {}).get(infra_type, {})
        total_mb_in_group = ws_stats.get("mailbox_count", 1)

        # Calculate proportional stats
        ratio = mb_count / total_mb_in_group if total_mb_in_group > 0 else 0

        sent = round(ws_stats.get("sent", 0) * ratio)
        replied = round(ws_stats.get("replied", 0) * ratio)
        bounced = round(ws_stats.get("bounced", 0) * ratio)
        interested = round(ws_stats.get("interested", 0) * ratio)

        # Calculate rates
        reply_rate = round(replied / sent * 100, 4) if sent > 0 else 0
        bounce_rate = round(bounced / sent * 100, 4) if sent > 0 else 0

        domain_stats.append({
            "date": today,
            "domain": domain,
            "workspace_name": workspace_name,
            "infra_type": infra_type,
            "tld": group["tld"],
            "mailbox_count": mb_count,
            "emails_sent": sent,
            "replies": replied,
            "bounces": bounced,
            "interested": interested,
            "reply_rate": reply_rate,
            "bounce_rate": bounce_rate,
        })

    return domain_stats


def aggregate_by_infra(mailboxes: list, stats_by_workspace_infra: dict) -> list:
    """
    Aggregate data by workspace + infra type for daily_infra_stats
    """
    today = datetime.now().strftime("%Y-%m-%d")
    infra_stats = []

    # Group mailboxes by workspace + infra
    workspace_infra_groups = defaultdict(lambda: defaultdict(list))
    for mb in mailboxes:
        workspace_infra_groups[mb["workspace_name"]][mb["infra_type"]].append(mb)

    for workspace_name, infra_groups in workspace_infra_groups.items():
        for infra_type, mb_list in infra_groups.items():
            # Calculate counts
            mailbox_count = len(mb_list)
            domains = set(mb["domain"] for mb in mb_list if mb["domain"])
            domain_count = len(domains)

            # Calculate capacity
            current_capacity = sum(mb.get("daily_limit", 0) for mb in mb_list)
            theoretical_max = mailbox_count * INFRA_MAX_LIMITS.get(infra_type, 10)

            # Count warmup status
            in_warmup = sum(1 for mb in mb_list if mb.get("warmup_enabled", False))

            # Get stats
            ws_stats = stats_by_workspace_infra.get(workspace_name, {}).get(infra_type, {})
            sent = ws_stats.get("sent", 0)
            replied = ws_stats.get("replied", 0)
            bounced = ws_stats.get("bounced", 0)
            interested = ws_stats.get("interested", 0)

            # Calculate rates
            reply_rate = round(replied / sent * 100, 4) if sent > 0 else 0
            bounce_rate = round(bounced / sent * 100, 4) if sent > 0 else 0
            positive_rate = round(interested / sent * 100, 4) if sent > 0 else 0

            infra_stats.append({
                "date": today,
                "workspace_name": workspace_name,
                "infra_type": infra_type,
                "mailbox_count": mailbox_count,
                "domain_count": domain_count,
                "emails_sent": sent,
                "replies": replied,
                "bounces": bounced,
                "interested": interested,
                "current_capacity": current_capacity,
                "theoretical_max": theoretical_max,
                "in_warmup": in_warmup,
                "reply_rate": reply_rate,
                "bounce_rate": bounce_rate,
                "positive_rate": positive_rate,
            })

    return infra_stats


def collect_and_store():
    """
    Main collection function - fetches all data and stores in Supabase
    """
    print("=" * 80)
    print("RGL Infra Data Collector")
    print(f"Started at: {datetime.now().isoformat()}")
    print("=" * 80)

    # Step 1: Fetch all mailboxes with warmup details
    mailboxes = fetch_all_mailboxes_with_details()
    print(f"\nTotal tracked mailboxes: {len(mailboxes)}")

    # Step 2: Fetch time-filtered stats (last 30 days for current snapshot)
    stats_by_workspace_infra = fetch_stats_for_mailboxes(mailboxes, days=30)

    # Step 3: Prepare mailbox_snapshots data
    print("\n" + "-" * 40)
    print("Storing mailbox_snapshots...")

    # Update mailboxes with stats (proportionally distributed)
    for mb in mailboxes:
        ws_stats = stats_by_workspace_infra.get(mb["workspace_name"], {}).get(mb["infra_type"], {})
        total_mb = ws_stats.get("mailbox_count", 1)
        ratio = 1 / total_mb if total_mb > 0 else 0

        mb["emails_sent"] = int(ws_stats.get("sent", 0) * ratio)
        mb["replies"] = int(ws_stats.get("replied", 0) * ratio)
        mb["bounces"] = int(ws_stats.get("bounced", 0) * ratio)
        mb["interested"] = int(ws_stats.get("interested", 0) * ratio)
        mb["updated_at"] = datetime.now().isoformat()

    result = supabase_upsert("mailbox_snapshots", mailboxes, on_conflict="email")
    print(f"  mailbox_snapshots: {result}")

    # Step 4: Aggregate and store daily_infra_stats
    print("\nStoring daily_infra_stats...")
    infra_stats = aggregate_by_infra(mailboxes, stats_by_workspace_infra)
    result = supabase_upsert("daily_infra_stats", infra_stats, on_conflict="date,workspace_name,infra_type")
    print(f"  daily_infra_stats: {result}")

    # Step 5: Aggregate and store daily_domain_stats
    print("\nStoring daily_domain_stats...")
    domain_stats = aggregate_by_domain(mailboxes, stats_by_workspace_infra)
    # Deduplicate by (date, domain, workspace_name)
    domain_key_map = {}
    for ds in domain_stats:
        key = (ds["date"], ds["domain"], ds["workspace_name"])
        if key not in domain_key_map:
            domain_key_map[key] = ds.copy()
        else:
            existing = domain_key_map[key]
            existing["mailbox_count"] += ds["mailbox_count"]
            existing["emails_sent"] += ds["emails_sent"]
            existing["replies"] += ds["replies"]
            existing["bounces"] += ds["bounces"]
            existing["interested"] += ds["interested"]
            if existing["emails_sent"] > 0:
                existing["reply_rate"] = round(existing["replies"] / existing["emails_sent"] * 100, 4)
                existing["bounce_rate"] = round(existing["bounces"] / existing["emails_sent"] * 100, 4)
    domain_stats = list(domain_key_map.values())
    result = supabase_upsert("daily_domain_stats", domain_stats, on_conflict="date,domain,workspace_name")
    print(f"  daily_domain_stats: {result}")

    # Summary
    print("\n" + "=" * 80)
    print("Collection Complete!")
    print(f"  Mailboxes: {len(mailboxes)}")
    print(f"  Infra stats records: {len(infra_stats)}")
    print(f"  Domain stats records: {len(domain_stats)}")
    print(f"Finished at: {datetime.now().isoformat()}")
    print("=" * 80)

    return {
        "mailboxes": len(mailboxes),
        "infra_stats": len(infra_stats),
        "domain_stats": len(domain_stats),
    }


def collect_for_date(target_date: str, days_back: int = 7):
    """
    Collect data for a specific date using stats from days_back period ending on that date
    This allows backfilling historical data
    """
    print("=" * 80)
    print(f"RGL Infra Data Collector - Backfill for {target_date}")
    print(f"Started at: {datetime.now().isoformat()}")
    print("=" * 80)

    # Step 1: Fetch all mailboxes with warmup details
    mailboxes = fetch_all_mailboxes_with_details()
    print(f"\nTotal tracked mailboxes: {len(mailboxes)}")

    # Step 2: Fetch time-filtered stats for the period ending on target_date
    stats_by_workspace_infra = fetch_stats_for_mailboxes(mailboxes, days=days_back)

    # Step 3: Aggregate and store daily_infra_stats for target_date
    print(f"\nStoring daily_infra_stats for {target_date}...")
    infra_stats = aggregate_by_infra_for_date(mailboxes, stats_by_workspace_infra, target_date, days_back)
    result = supabase_upsert("daily_infra_stats", infra_stats, on_conflict="date,workspace_name,infra_type")
    print(f"  daily_infra_stats: {result}")

    # Step 4: Aggregate and store daily_domain_stats for target_date
    print(f"\nStoring daily_domain_stats for {target_date}...")
    domain_stats = aggregate_by_domain_for_date(mailboxes, stats_by_workspace_infra, target_date, days_back)
    # Deduplicate by (date, domain, workspace_name)
    domain_key_map = {}
    for ds in domain_stats:
        key = (ds["date"], ds["domain"], ds["workspace_name"])
        if key not in domain_key_map:
            domain_key_map[key] = ds.copy()
        else:
            existing = domain_key_map[key]
            existing["mailbox_count"] += ds["mailbox_count"]
            existing["emails_sent"] += ds["emails_sent"]
            existing["replies"] += ds["replies"]
            existing["bounces"] += ds["bounces"]
            existing["interested"] += ds["interested"]
            if existing["emails_sent"] > 0:
                existing["reply_rate"] = round(existing["replies"] / existing["emails_sent"] * 100, 4)
                existing["bounce_rate"] = round(existing["bounces"] / existing["emails_sent"] * 100, 4)
    domain_stats = list(domain_key_map.values())
    result = supabase_upsert("daily_domain_stats", domain_stats, on_conflict="date,domain,workspace_name")
    print(f"  daily_domain_stats: {result}")

    print("\n" + "=" * 80)
    print(f"Backfill Complete for {target_date}!")
    print(f"  Infra stats records: {len(infra_stats)}")
    print(f"  Domain stats records: {len(domain_stats)}")
    print("=" * 80)


def aggregate_by_infra_for_date(mailboxes: list, stats_by_workspace_infra: dict, target_date: str, days: int) -> list:
    """
    Aggregate data by workspace + infra type for a specific date
    Divides cumulative stats by number of days to get daily average
    """
    infra_stats = []

    # Group mailboxes by workspace + infra
    workspace_infra_groups = defaultdict(lambda: defaultdict(list))
    for mb in mailboxes:
        workspace_infra_groups[mb["workspace_name"]][mb["infra_type"]].append(mb)

    for workspace_name, infra_groups in workspace_infra_groups.items():
        for infra_type, mb_list in infra_groups.items():
            mailbox_count = len(mb_list)
            domains = set(mb["domain"] for mb in mb_list if mb["domain"])
            domain_count = len(domains)

            current_capacity = sum(mb.get("daily_limit", 0) for mb in mb_list)
            theoretical_max = mailbox_count * INFRA_MAX_LIMITS.get(infra_type, 10)
            in_warmup = sum(1 for mb in mb_list if mb.get("warmup_enabled", False))

            ws_stats = stats_by_workspace_infra.get(workspace_name, {}).get(infra_type, {})

            # Divide by days to get daily average
            sent = int(ws_stats.get("sent", 0) / days)
            replied = int(ws_stats.get("replied", 0) / days)
            bounced = int(ws_stats.get("bounced", 0) / days)
            interested = int(ws_stats.get("interested", 0) / days)

            reply_rate = round(replied / sent * 100, 4) if sent > 0 else 0
            bounce_rate = round(bounced / sent * 100, 4) if sent > 0 else 0
            positive_rate = round(interested / sent * 100, 4) if sent > 0 else 0

            infra_stats.append({
                "date": target_date,
                "workspace_name": workspace_name,
                "infra_type": infra_type,
                "mailbox_count": mailbox_count,
                "domain_count": domain_count,
                "emails_sent": sent,
                "replies": replied,
                "bounces": bounced,
                "interested": interested,
                "current_capacity": current_capacity,
                "theoretical_max": theoretical_max,
                "in_warmup": in_warmup,
                "reply_rate": reply_rate,
                "bounce_rate": bounce_rate,
                "positive_rate": positive_rate,
            })

    return infra_stats


def aggregate_by_domain_for_date(mailboxes: list, stats_by_workspace_infra: dict, target_date: str, days: int) -> list:
    """
    Aggregate mailbox data by domain for a specific date
    """
    domain_groups = defaultdict(lambda: {
        "workspace_name": None,
        "infra_type": None,
        "tld": None,
        "mailboxes": [],
    })

    for mb in mailboxes:
        key = (mb["domain"], mb["workspace_name"])
        group = domain_groups[key]
        group["workspace_name"] = mb["workspace_name"]
        group["infra_type"] = mb["infra_type"]
        group["tld"] = mb["tld"]
        group["mailboxes"].append(mb)

    domain_stats = []

    for (domain, workspace), group in domain_groups.items():
        if not domain:
            continue

        infra_type = group["infra_type"]
        workspace_name = group["workspace_name"]
        mb_count = len(group["mailboxes"])

        ws_stats = stats_by_workspace_infra.get(workspace_name, {}).get(infra_type, {})
        total_mb_in_group = ws_stats.get("mailbox_count", 1)

        ratio = mb_count / total_mb_in_group if total_mb_in_group > 0 else 0

        # Get proportional stats and divide by days
        sent = round(ws_stats.get("sent", 0) * ratio / days)
        replied = round(ws_stats.get("replied", 0) * ratio / days)
        bounced = round(ws_stats.get("bounced", 0) * ratio / days)
        interested = round(ws_stats.get("interested", 0) * ratio / days)

        reply_rate = round(replied / sent * 100, 4) if sent > 0 else 0
        bounce_rate = round(bounced / sent * 100, 4) if sent > 0 else 0

        domain_stats.append({
            "date": target_date,
            "domain": domain,
            "workspace_name": workspace_name,
            "infra_type": infra_type,
            "tld": group["tld"],
            "mailbox_count": mb_count,
            "emails_sent": sent,
            "replies": replied,
            "bounces": bounced,
            "interested": interested,
            "reply_rate": reply_rate,
            "bounce_rate": bounce_rate,
        })

    return domain_stats


def fetch_daily_stats_for_mailboxes(mailboxes: list, days: int = 14) -> dict:
    """
    Fetch REAL daily time-series stats for all mailboxes.

    Returns dict of workspace_name -> infra_type -> date -> {sent, replied, bounced, interested}
    """
    clients = get_all_workspace_clients()

    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    # Group mailboxes by workspace + infra
    workspace_infra_mailboxes = defaultdict(lambda: defaultdict(list))
    for mb in mailboxes:
        workspace = mb["workspace_name"]
        infra = mb["infra_type"]
        workspace_infra_mailboxes[workspace][infra].append(mb)

    # Result: workspace -> infra -> date -> stats
    daily_stats = defaultdict(lambda: defaultdict(dict))

    print(f"\nFetching REAL daily stats for {days} days ({start_str} to {end_str})...")

    for workspace_name, infra_groups in workspace_infra_mailboxes.items():
        client = clients.get(workspace_name)
        if not client:
            continue

        for infra_type, mb_list in infra_groups.items():
            mailbox_ids = [mb["external_id"] for mb in mb_list if mb.get("external_id")]

            print(f"  {workspace_name}/{infra_type}: {len(mailbox_ids)} mailboxes...", end=" ", flush=True)

            try:
                # Use the new daily breakdown method
                date_stats = client.get_sender_email_stats_daily(mailbox_ids, start_str, end_str)
                daily_stats[workspace_name][infra_type] = date_stats
                total_sent = sum(d.get("sent", 0) for d in date_stats.values())
                print(f"✓ {len(date_stats)} days, total_sent={total_sent}")
            except Exception as e:
                print(f"✗ {e}")
                daily_stats[workspace_name][infra_type] = {}

    return dict(daily_stats)


def backfill_with_real_daily_data(n_days: int = 14, exclude_recent_days: int = 0):
    """
    Backfill data for the last N days using REAL daily values from API.
    Each day gets its actual stats, not averaged values.

    Args:
        n_days: Number of days to fetch data for
        exclude_recent_days: Skip the most recent N days (e.g., 2 to skip today and yesterday)
    """
    print("=" * 80)
    print(f"BACKFILLING LAST {n_days} DAYS WITH REAL DAILY DATA")
    if exclude_recent_days > 0:
        print(f"(Excluding most recent {exclude_recent_days} days)")
    print("=" * 80)

    # First, fetch mailboxes once
    mailboxes = fetch_all_mailboxes_with_details()
    print(f"\nTotal tracked mailboxes: {len(mailboxes)}")

    # Fetch REAL daily stats (not cumulative)
    daily_stats = fetch_daily_stats_for_mailboxes(mailboxes, days=n_days)

    # Group mailboxes by workspace + infra for counts
    workspace_infra_mailboxes = defaultdict(lambda: defaultdict(list))
    for mb in mailboxes:
        workspace_infra_mailboxes[mb["workspace_name"]][mb["infra_type"]].append(mb)

    # Get all dates from the data
    all_dates = set()
    for ws_data in daily_stats.values():
        for infra_data in ws_data.values():
            all_dates.update(infra_data.keys())

    print(f"\nFound data for {len(all_dates)} dates: {sorted(all_dates)[:5]}...")

    # Filter out recent dates if requested
    if exclude_recent_days > 0:
        cutoff_date = (datetime.now() - timedelta(days=exclude_recent_days)).strftime("%Y-%m-%d")
        all_dates = {d for d in all_dates if d < cutoff_date}
        print(f"After excluding recent {exclude_recent_days} days, processing {len(all_dates)} dates")

    # Create records for each date
    for target_date in sorted(all_dates, reverse=True):
        print(f"\n--- Storing data for {target_date} ---")

        infra_stats = []
        domain_stats = []

        for workspace_name, infra_groups in workspace_infra_mailboxes.items():
            for infra_type, mb_list in infra_groups.items():
                # Get daily stats for this workspace/infra/date
                date_stats = daily_stats.get(workspace_name, {}).get(infra_type, {}).get(target_date, {})

                sent = date_stats.get("sent", 0)
                replied = date_stats.get("replied", 0)
                bounced = date_stats.get("bounced", 0)
                interested = date_stats.get("interested", 0)

                # Calculate counts from mailboxes
                mailbox_count = len(mb_list)
                domains = set(mb["domain"] for mb in mb_list if mb["domain"])
                domain_count = len(domains)

                # Calculate capacity
                current_capacity = sum(mb.get("daily_limit", 0) for mb in mb_list)
                theoretical_max = mailbox_count * INFRA_MAX_LIMITS.get(infra_type, 10)
                in_warmup = sum(1 for mb in mb_list if mb.get("warmup_enabled", False))

                # Calculate rates
                reply_rate = round(replied / sent * 100, 4) if sent > 0 else 0
                bounce_rate = round(bounced / sent * 100, 4) if sent > 0 else 0
                positive_rate = round(interested / sent * 100, 4) if sent > 0 else 0

                infra_stats.append({
                    "date": target_date,
                    "workspace_name": workspace_name,
                    "infra_type": infra_type,
                    "mailbox_count": mailbox_count,
                    "domain_count": domain_count,
                    "emails_sent": sent,
                    "replies": replied,
                    "bounces": bounced,
                    "interested": interested,
                    "current_capacity": current_capacity,
                    "theoretical_max": theoretical_max,
                    "in_warmup": in_warmup,
                    "reply_rate": reply_rate,
                    "bounce_rate": bounce_rate,
                    "positive_rate": positive_rate,
                })

                # Aggregate domain stats
                domain_groups = defaultdict(list)
                for mb in mb_list:
                    if mb["domain"]:
                        domain_groups[mb["domain"]].append(mb)

                for domain, domain_mbs in domain_groups.items():
                    mb_count_domain = len(domain_mbs)
                    ratio = mb_count_domain / mailbox_count if mailbox_count > 0 else 0

                    domain_sent = round(sent * ratio)
                    domain_replied = round(replied * ratio)
                    domain_bounced = round(bounced * ratio)
                    domain_interested = round(interested * ratio)

                    domain_stats.append({
                        "date": target_date,
                        "domain": domain,
                        "workspace_name": workspace_name,
                        "infra_type": infra_type,
                        "tld": domain_mbs[0].get("tld", ""),
                        "mailbox_count": mb_count_domain,
                        "emails_sent": domain_sent,
                        "replies": domain_replied,
                        "bounces": domain_bounced,
                        "interested": domain_interested,
                        "reply_rate": round(domain_replied / domain_sent * 100, 4) if domain_sent > 0 else 0,
                        "bounce_rate": round(domain_bounced / domain_sent * 100, 4) if domain_sent > 0 else 0,
                    })

        result = supabase_upsert("daily_infra_stats", infra_stats, on_conflict="date,workspace_name,infra_type")
        print(f"  daily_infra_stats: {result}")

        # Deduplicate domain_stats - aggregate by (date, domain, workspace_name)
        domain_key_map = {}
        for ds in domain_stats:
            key = (ds["date"], ds["domain"], ds["workspace_name"])
            if key not in domain_key_map:
                domain_key_map[key] = ds.copy()
            else:
                # Aggregate stats
                existing = domain_key_map[key]
                existing["mailbox_count"] += ds["mailbox_count"]
                existing["emails_sent"] += ds["emails_sent"]
                existing["replies"] += ds["replies"]
                existing["bounces"] += ds["bounces"]
                existing["interested"] += ds["interested"]
                # Recalculate rates
                if existing["emails_sent"] > 0:
                    existing["reply_rate"] = round(existing["replies"] / existing["emails_sent"] * 100, 4)
                    existing["bounce_rate"] = round(existing["bounces"] / existing["emails_sent"] * 100, 4)

        deduplicated_domain_stats = list(domain_key_map.values())
        result = supabase_upsert("daily_domain_stats", deduplicated_domain_stats, on_conflict="date,domain,workspace_name")
        print(f"  daily_domain_stats: {result}")

    print("\n" + "=" * 80)
    print(f"Backfill Complete! Created {len(all_dates)} days of REAL historical data.")
    print("=" * 80)


def backfill_last_n_days(n_days: int = 14, exclude_recent: int = 0):
    """
    Backfill data for the last N days using REAL daily data from API.

    Args:
        n_days: Number of days to fetch
        exclude_recent: Skip most recent N days (useful for not overwriting today's data)
    """
    backfill_with_real_daily_data(n_days, exclude_recent_days=exclude_recent)


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "backfill":
        days = int(sys.argv[2]) if len(sys.argv) > 2 else 14
        # Optional third arg: exclude recent days
        exclude = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        backfill_last_n_days(days, exclude)
    else:
        collect_and_store()
