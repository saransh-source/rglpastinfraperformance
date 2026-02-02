"""
RGL Infra Tracking - Analyzer
Aggregates mailbox stats by infra type across all workspaces
Includes warmup data, TLD breakdown, and theoretical capacity calculations
"""

from datetime import datetime, timedelta
from collections import defaultdict

from config import (
    TAG_TO_INFRA, TIME_PERIODS, TRACKED_INFRA_TYPES,
    INFRA_MAX_LIMITS, INFRA_COSTS
)
from api_client import get_all_workspace_clients, RevGenLabsAPI


def get_infra_type_from_tags(tags: list) -> str:
    """
    Extract infra type from mailbox tags
    Only returns types in TRACKED_INFRA_TYPES, otherwise None
    """
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
    """Extract TLD from domain (e.g., 'example.com' -> '.com')"""
    if not domain or "." not in domain:
        return ""
    return "." + domain.split(".")[-1].lower()


def get_date_range(period: str) -> tuple[str, str, int]:
    """Get start and end date for a time period, plus number of days"""
    days = TIME_PERIODS.get(period, 30)
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    return start_date.strftime("%Y-%m-%d"), end_date.strftime("%Y-%m-%d"), days


def fetch_all_mailboxes_with_infra() -> dict:
    """
    Fetch all mailboxes from all workspaces with detailed info
    
    Returns:
        {
            "by_infra": {infra_type: [mailbox_info, ...]},
            "by_workspace_infra": {workspace: {infra_type: [mailbox_info, ...]}},
            "by_tld": {tld: [mailbox_info, ...]},
            "by_infra_tld": {infra_type: {tld: [mailbox_info, ...]}},
            "warmup_data": {workspace: [warmup_info, ...]},
            "clients": {workspace: client}
        }
    """
    clients = get_all_workspace_clients()
    
    by_infra = defaultdict(list)
    by_workspace_infra = defaultdict(lambda: defaultdict(list))
    by_tld = defaultdict(list)
    by_infra_tld = defaultdict(lambda: defaultdict(list))
    warmup_data = {}
    
    print("Fetching mailboxes from all workspaces...")
    
    for workspace_name, client in clients.items():
        print(f"  {workspace_name}...", end=" ", flush=True)
        
        try:
            mailboxes = client.get_sender_emails()
            
            # Fetch warmup data for this workspace
            try:
                warmup_list = client.get_warmup_status()
                warmup_data[workspace_name] = warmup_list
            except Exception as e:
                warmup_data[workspace_name] = []
            
            tracked_count = 0
            for mb in mailboxes:
                infra_type = get_infra_type_from_tags(mb.get("tags", []))
                if infra_type:
                    domain = extract_domain(mb.get("email", ""))
                    tld = extract_tld(domain)
                    
                    mb_info = {
                        "id": mb["id"],
                        "email": mb.get("email", ""),
                        "domain": domain,
                        "tld": tld,
                        "workspace": workspace_name,
                        "daily_limit": mb.get("daily_limit", 0),
                        "status": mb.get("status", ""),
                        "infra_type": infra_type,
                    }
                    
                    by_infra[infra_type].append(mb_info)
                    by_workspace_infra[workspace_name][infra_type].append(mb_info)
                    
                    # TLD aggregation
                    if tld:
                        by_tld[tld].append(mb_info)
                        by_infra_tld[infra_type][tld].append(mb_info)
                    
                    tracked_count += 1
            
            print(f"✓ {tracked_count}/{len(mailboxes)} tracked")
            
        except Exception as e:
            print(f"✗ Error: {e}")
    
    return {
        "by_infra": dict(by_infra),
        "by_workspace_infra": dict(by_workspace_infra),
        "by_tld": dict(by_tld),
        "by_infra_tld": {k: dict(v) for k, v in by_infra_tld.items()},
        "warmup_data": warmup_data,
        "clients": clients,
    }


def calculate_warmup_stats(warmup_data: dict, by_infra: dict) -> dict:
    """
    Calculate warmup statistics per infra type
    
    The warmup API returns records with:
    - id: sender email ID
    - warmup_enabled: boolean, whether warmup is active
    - warmup_daily_limit: current warmup daily limit
    
    Returns dict with warmup counts and status per infra type
    """
    # Build a lookup of mailbox ID to infra type
    id_to_infra = {}
    for infra_type, mailboxes in by_infra.items():
        for mb in mailboxes:
            id_to_infra[mb["id"]] = infra_type
    
    warmup_stats = {infra: {"in_warmup": 0, "ready": 0, "total_warmup_limit": 0} 
                    for infra in TRACKED_INFRA_TYPES}
    
    for workspace_name, warmup_list in warmup_data.items():
        for item in warmup_list:
            mb_id = item.get("id")
            if mb_id and mb_id in id_to_infra:
                infra_type = id_to_infra[mb_id]
                warmup_enabled = item.get("warmup_enabled", False)
                warmup_limit = item.get("warmup_daily_limit", 0)
                
                if warmup_enabled and warmup_limit > 0:
                    warmup_stats[infra_type]["in_warmup"] += 1
                    warmup_stats[infra_type]["total_warmup_limit"] += warmup_limit
                elif not warmup_enabled:
                    # Warmup disabled = ready/graduated
                    warmup_stats[infra_type]["ready"] += 1
    
    # Calculate averages
    for infra_type, stats in warmup_stats.items():
        if stats["in_warmup"] > 0:
            stats["avg_warmup_limit"] = round(stats["total_warmup_limit"] / stats["in_warmup"], 1)
        else:
            stats["avg_warmup_limit"] = 0
    
    return warmup_stats


def calculate_metrics(sent: int, replied: int, interested: int, bounced: int, 
                      mailboxes: int, num_days: int) -> dict:
    """Calculate all derived metrics from raw counts"""
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
    
    # Positive reply rate (interested / replied)
    if replied > 0:
        metrics["positive_reply_rate"] = round(interested / replied * 100, 2)
    else:
        metrics["positive_reply_rate"] = 0
    
    # Avg sends per mailbox per day
    if mailboxes > 0 and num_days > 0:
        metrics["avg_sends_per_mailbox_per_day"] = round(sent / mailboxes / num_days, 2)
    else:
        metrics["avg_sends_per_mailbox_per_day"] = 0
    
    # Positives per day
    if num_days > 0:
        metrics["positives_per_day"] = round(interested / num_days, 2)
    else:
        metrics["positives_per_day"] = 0
    
    return metrics


def analyze_period(mailbox_data: dict, period: str) -> dict:
    """
    Analyze a specific time period using time-filtered API
    
    Returns aggregated stats by infra type, by client, by TLD, and by infra+TLD
    """
    start_date, end_date, num_days = get_date_range(period)
    
    clients = mailbox_data["clients"]
    by_workspace_infra = mailbox_data["by_workspace_infra"]
    by_infra = mailbox_data["by_infra"]
    by_tld = mailbox_data["by_tld"]
    by_infra_tld = mailbox_data["by_infra_tld"]
    warmup_data = mailbox_data["warmup_data"]
    
    print(f"\nAnalyzing {period} ({start_date} to {end_date}, {num_days} days)...")
    
    # Calculate warmup stats
    warmup_stats = calculate_warmup_stats(warmup_data, by_infra)
    
    # Initialize stats structures
    infra_stats = {}
    for infra_type in TRACKED_INFRA_TYPES:
        mailboxes = by_infra.get(infra_type, [])
        domains = set(mb["domain"] for mb in mailboxes if mb["domain"])
        current_capacity = sum(mb.get("daily_limit", 0) for mb in mailboxes)
        theoretical_max = len(mailboxes) * INFRA_MAX_LIMITS.get(infra_type, 10)
        
        infra_stats[infra_type] = {
            "mailbox_count": len(mailboxes),
            "domain_count": len(domains),
            "current_capacity": current_capacity,
            "theoretical_max": theoretical_max,
            "sent": 0,
            "replied": 0,
            "bounced": 0,
            "interested": 0,
            "workspaces": set(),
            # Warmup data
            "in_warmup": warmup_stats[infra_type]["in_warmup"],
            "ready": warmup_stats[infra_type]["ready"],
            "avg_warmup_limit": warmup_stats[infra_type]["avg_warmup_limit"],
        }
    
    # Per-workspace per-infra stats
    workspace_infra_stats = defaultdict(lambda: defaultdict(lambda: {
        "mailbox_count": 0,
        "domain_count": 0,
        "current_capacity": 0,
        "theoretical_max": 0,
        "sent": 0,
        "replied": 0,
        "bounced": 0,
        "interested": 0,
    }))
    
    # TLD stats structures
    tld_stats = defaultdict(lambda: {
        "mailbox_count": 0,
        "domain_count": 0,
        "sent": 0,
        "replied": 0,
        "bounced": 0,
        "interested": 0,
    })
    
    infra_tld_stats = defaultdict(lambda: defaultdict(lambda: {
        "mailbox_count": 0,
        "domain_count": 0,
        "sent": 0,
        "replied": 0,
        "bounced": 0,
        "interested": 0,
    }))
    
    # Build mailbox ID to TLD mapping for stats aggregation
    id_to_mailbox = {}
    for infra_type, mailboxes in by_infra.items():
        for mb in mailboxes:
            id_to_mailbox[mb["id"]] = mb
    
    # Fetch time-filtered stats per workspace per infra type
    for workspace_name, infra_mailboxes in by_workspace_infra.items():
        client = clients.get(workspace_name)
        if not client:
            continue
        
        for infra_type, mailboxes in infra_mailboxes.items():
            if not mailboxes or infra_type not in infra_stats:
                continue
            
            mailbox_ids = [mb["id"] for mb in mailboxes]
            domains = set(mb["domain"] for mb in mailboxes if mb["domain"])
            current_capacity = sum(mb.get("daily_limit", 0) for mb in mailboxes)
            theoretical_max = len(mailboxes) * INFRA_MAX_LIMITS.get(infra_type, 10)
            
            print(f"  {workspace_name}/{infra_type}: {len(mailbox_ids)} mailboxes...", end=" ", flush=True)
            
            try:
                stats = client.get_sender_email_stats(mailbox_ids, start_date, end_date)
                
                sent = stats.get("sent", 0)
                replied = stats.get("replied", 0)
                bounced = stats.get("bounced", 0)
                interested = stats.get("interested", 0)
                
                # Update infra-level stats
                infra_stats[infra_type]["sent"] += sent
                infra_stats[infra_type]["replied"] += replied
                infra_stats[infra_type]["bounced"] += bounced
                infra_stats[infra_type]["interested"] += interested
                infra_stats[infra_type]["workspaces"].add(workspace_name)
                
                # Update workspace-infra stats
                ws_stats = workspace_infra_stats[workspace_name][infra_type]
                ws_stats["mailbox_count"] = len(mailboxes)
                ws_stats["domain_count"] = len(domains)
                ws_stats["current_capacity"] = current_capacity
                ws_stats["theoretical_max"] = theoretical_max
                ws_stats["sent"] = sent
                ws_stats["replied"] = replied
                ws_stats["bounced"] = bounced
                ws_stats["interested"] = interested
                
                # Aggregate TLD stats (proportional distribution based on mailbox count per TLD)
                # Group mailboxes by TLD for this infra
                tld_mailbox_counts = defaultdict(int)
                for mb in mailboxes:
                    if mb["tld"]:
                        tld_mailbox_counts[mb["tld"]] += 1
                
                total_mb = len(mailboxes)
                for tld, count in tld_mailbox_counts.items():
                    ratio = count / total_mb if total_mb > 0 else 0
                    
                    # Distribute stats proportionally by TLD
                    tld_stats[tld]["mailbox_count"] += count
                    tld_stats[tld]["sent"] += int(sent * ratio)
                    tld_stats[tld]["replied"] += int(replied * ratio)
                    tld_stats[tld]["bounced"] += int(bounced * ratio)
                    tld_stats[tld]["interested"] += int(interested * ratio)
                    
                    # Infra + TLD stats
                    infra_tld_stats[infra_type][tld]["mailbox_count"] += count
                    infra_tld_stats[infra_type][tld]["sent"] += int(sent * ratio)
                    infra_tld_stats[infra_type][tld]["replied"] += int(replied * ratio)
                    infra_tld_stats[infra_type][tld]["bounced"] += int(bounced * ratio)
                    infra_tld_stats[infra_type][tld]["interested"] += int(interested * ratio)
                
                print(f"✓ sent={sent}")
                
            except Exception as e:
                print(f"✗ {e}")
    
    # Calculate derived metrics for infra stats
    for infra_type, stats in infra_stats.items():
        stats["workspaces"] = list(stats["workspaces"])
        stats["workspace_count"] = len(stats["workspaces"])
        
        metrics = calculate_metrics(
            stats["sent"], stats["replied"], stats["interested"], stats["bounced"],
            stats["mailbox_count"], num_days
        )
        stats.update(metrics)
    
    # Calculate derived metrics for workspace-infra stats
    for workspace_name, infra_data in workspace_infra_stats.items():
        for infra_type, stats in infra_data.items():
            metrics = calculate_metrics(
                stats["sent"], stats["replied"], stats["interested"], stats["bounced"],
                stats["mailbox_count"], num_days
            )
            stats.update(metrics)
    
    # Calculate derived metrics for TLD stats
    for tld, stats in tld_stats.items():
        # Count unique domains for this TLD
        stats["domain_count"] = len(set(
            mb["domain"] for infra_mbs in by_infra.values() 
            for mb in infra_mbs if mb["tld"] == tld
        ))
        metrics = calculate_metrics(
            stats["sent"], stats["replied"], stats["interested"], stats["bounced"],
            stats["mailbox_count"], num_days
        )
        stats.update(metrics)
    
    # Calculate derived metrics for infra+TLD stats
    for infra_type, tld_data in infra_tld_stats.items():
        for tld, stats in tld_data.items():
            stats["domain_count"] = len(set(
                mb["domain"] for mb in by_infra.get(infra_type, []) 
                if mb["tld"] == tld
            ))
            metrics = calculate_metrics(
                stats["sent"], stats["replied"], stats["interested"], stats["bounced"],
                stats["mailbox_count"], num_days
            )
            stats.update(metrics)
    
    # Calculate totals
    totals = {
        "mailbox_count": sum(s["mailbox_count"] for s in infra_stats.values()),
        "domain_count": sum(s["domain_count"] for s in infra_stats.values()),
        "current_capacity": sum(s["current_capacity"] for s in infra_stats.values()),
        "theoretical_max": sum(s["theoretical_max"] for s in infra_stats.values()),
        "sent": sum(s["sent"] for s in infra_stats.values()),
        "replied": sum(s["replied"] for s in infra_stats.values()),
        "bounced": sum(s["bounced"] for s in infra_stats.values()),
        "interested": sum(s["interested"] for s in infra_stats.values()),
        "in_warmup": sum(s["in_warmup"] for s in infra_stats.values()),
        "ready": sum(s["ready"] for s in infra_stats.values()),
    }
    
    total_metrics = calculate_metrics(
        totals["sent"], totals["replied"], totals["interested"], totals["bounced"],
        totals["mailbox_count"], num_days
    )
    totals.update(total_metrics)
    
    # Convert to regular dicts
    by_client = {}
    for workspace_name, infra_data in workspace_infra_stats.items():
        by_client[workspace_name] = dict(infra_data)
    
    by_tld_output = dict(tld_stats)
    by_infra_tld_output = {k: dict(v) for k, v in infra_tld_stats.items()}
    
    return {
        "by_infra": infra_stats,
        "by_client": by_client,
        "by_tld": by_tld_output,
        "by_infra_tld": by_infra_tld_output,
        "totals": totals,
        "meta": {
            "period": period,
            "days": num_days,
            "start_date": start_date,
            "end_date": end_date,
            "generated_at": datetime.now().isoformat(),
        }
    }


def calculate_cost_projections(target_sends: int = 100000) -> dict:
    """
    Calculate cost projections for reaching target sends per day
    
    Returns dict with projections per infra type
    """
    projections = {}
    
    for infra_type in TRACKED_INFRA_TYPES:
        costs = INFRA_COSTS.get(infra_type, {})
        sends_per_day = costs.get("sends_per_day", INFRA_MAX_LIMITS.get(infra_type, 10))
        
        if sends_per_day <= 0:
            projections[infra_type] = {"feasible": False, "reason": "No sends per day defined"}
            continue
        
        mailboxes_needed = target_sends // sends_per_day
        if mailboxes_needed > 50000:
            projections[infra_type] = {
                "feasible": False,
                "reason": "Impractical (>50k mailboxes needed)",
                "mailboxes_needed": mailboxes_needed,
            }
            continue
        
        monthly_cost = mailboxes_needed * costs.get("monthly_per_mailbox", 0)
        
        # Calculate one-time setup cost
        setup_cost = 0
        domains_needed = 0
        
        if "mailboxes_per_tenant" in costs:
            # Aged Outlook / Outlook style
            tenants_needed = mailboxes_needed // costs.get("mailboxes_per_tenant", 25)
            domains_needed = tenants_needed * costs.get("domains_per_tenant", 5)
            setup_cost = (
                tenants_needed * costs.get("tenant_cost", 0) +
                domains_needed * costs.get("aged_domain_cost", costs.get("domain_cost", 0))
            )
        else:
            # Maldoso / GR style
            mailboxes_per_domain = costs.get("mailboxes_per_domain", 4)
            domains_needed = mailboxes_needed // mailboxes_per_domain
            setup_cost = (
                domains_needed * costs.get("domain_cost", 0) +
                mailboxes_needed * costs.get("setup_per_mailbox", 0)
            )
        
        projections[infra_type] = {
            "feasible": True,
            "target_sends": target_sends,
            "sends_per_day": sends_per_day,
            "mailboxes_needed": mailboxes_needed,
            "domains_needed": domains_needed,
            "monthly_cost": round(monthly_cost, 2),
            "setup_cost": round(setup_cost, 2),
            "warmup_weeks": costs.get("warmup_weeks", 4),
        }
    
    return projections


def analyze_all_periods() -> dict:
    """
    Analyze all time periods
    
    Returns dict with data for each period plus cost projections
    """
    # First fetch all mailboxes (only need to do this once)
    mailbox_data = fetch_all_mailboxes_with_infra()
    
    # Print mailbox summary
    print("\n" + "=" * 80)
    print("MAILBOX SUMMARY (Tracked Infra Types Only)")
    print("=" * 80)
    print(f"{'Infra Type':<18} {'Mailboxes':>10} {'Domains':>10} {'Current Cap':>12} {'Theo Max':>10}")
    print("-" * 65)
    
    for infra_type in TRACKED_INFRA_TYPES:
        mailboxes = mailbox_data["by_infra"].get(infra_type, [])
        domains = set(mb["domain"] for mb in mailboxes if mb["domain"])
        current_cap = sum(mb.get("daily_limit", 0) for mb in mailboxes)
        theo_max = len(mailboxes) * INFRA_MAX_LIMITS.get(infra_type, 10)
        print(f"{infra_type:<18} {len(mailboxes):>10,} {len(domains):>10,} {current_cap:>12,} {theo_max:>10,}")
    
    # Print TLD summary
    print("\n" + "=" * 80)
    print("TLD SUMMARY")
    print("=" * 80)
    for tld in sorted(mailbox_data["by_tld"].keys(), key=lambda x: len(mailbox_data["by_tld"][x]), reverse=True)[:10]:
        count = len(mailbox_data["by_tld"][tld])
        print(f"  {tld}: {count:,} mailboxes")
    
    # Analyze each period
    all_results = {}
    for period in ["3d", "7d", "14d", "30d"]:
        results = analyze_period(mailbox_data, period)
        all_results[period] = results
        
        # Print summary
        print(f"\n{period} Summary:")
        print(f"  Total Sent: {results['totals']['sent']:,}")
        print(f"  Total Replied: {results['totals']['replied']:,}")
        print(f"  Total Interested: {results['totals']['interested']:,}")
        print(f"  Reply Rate: {results['totals']['reply_rate']:.2f}%")
        print(f"  Positive Rate: {results['totals']['positive_rate']:.3f}%")
        print(f"  Positive Reply Rate: {results['totals']['positive_reply_rate']:.2f}%")
        print(f"  Positives/Day: {results['totals']['positives_per_day']:.1f}")
    
    # Add cost projections
    all_results["projections"] = calculate_cost_projections(100000)
    
    return all_results


def print_summary(results: dict) -> None:
    """Print formatted summary"""
    for period, data in results.items():
        if period == "projections":
            continue
            
        days = data["meta"]["days"]
        
        print(f"\n{'=' * 110}")
        print(f"PERIOD: {period} ({days} days)")
        print(f"{'=' * 110}")
        
        # Infra comparison table
        print(f"\n{'Infra Type':<16} {'MBs':>6} {'Domains':>7} {'CurCap':>8} {'TheoMax':>8} {'Sent':>10} "
              f"{'Reply':>7} {'Int':>5} {'Reply%':>7} {'+ve%':>7} {'+veRep%':>8} {'Bnc%':>6}")
        print("-" * 110)
        
        for infra_type in TRACKED_INFRA_TYPES:
            s = data["by_infra"].get(infra_type, {})
            print(f"{infra_type:<16} {s.get('mailbox_count', 0):>6,} {s.get('domain_count', 0):>7,} "
                  f"{s.get('current_capacity', 0):>8,} {s.get('theoretical_max', 0):>8,} "
                  f"{s.get('sent', 0):>10,} {s.get('replied', 0):>7,} {s.get('interested', 0):>5} "
                  f"{s.get('reply_rate', 0):>6.2f}% {s.get('positive_rate', 0):>6.3f}% "
                  f"{s.get('positive_reply_rate', 0):>7.2f}% {s.get('bounce_rate', 0):>5.2f}%")
        
        # TLD breakdown
        print(f"\n--- BY TLD ---")
        print(f"{'TLD':<8} {'MBs':>6} {'Domains':>7} {'Sent':>10} {'Reply':>7} {'Int':>5} "
              f"{'Reply%':>7} {'+ve%':>7} {'Bnc%':>6}")
        print("-" * 75)
        
        for tld in sorted(data.get("by_tld", {}).keys(), 
                          key=lambda x: data["by_tld"][x].get("sent", 0), reverse=True)[:10]:
            s = data["by_tld"][tld]
            print(f"{tld:<8} {s.get('mailbox_count', 0):>6,} {s.get('domain_count', 0):>7,} "
                  f"{s.get('sent', 0):>10,} {s.get('replied', 0):>7,} {s.get('interested', 0):>5} "
                  f"{s.get('reply_rate', 0):>6.2f}% {s.get('positive_rate', 0):>6.3f}% "
                  f"{s.get('bounce_rate', 0):>5.2f}%")


if __name__ == "__main__":
    results = analyze_all_periods()
    print_summary(results)
