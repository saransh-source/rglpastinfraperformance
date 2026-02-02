"""
RGL Infra Tracking - Data Generator
Pre-generates analysis data for all time periods and saves as static JSON
"""

import json
import os
from datetime import datetime
from analyzer import analyze_all_workspaces
from config import TIME_PERIODS


def generate_all_data():
    """Generate analysis data for all time periods"""
    
    all_data = {}
    
    for period in TIME_PERIODS.keys():
        print(f"\n{'='*60}")
        print(f"Generating data for {period}...")
        print(f"{'='*60}")
        
        results = analyze_all_workspaces(period)
        all_data[period] = results
        
        # Print summary
        totals = results.get("totals", {})
        print(f"\nSummary for {period}:")
        print(f"  Total Sends: {totals.get('sends', 0):,}")
        print(f"  Total Replies: {totals.get('replies', 0):,}")
        print(f"  Reply Rate: {totals.get('reply_rate', 0):.2f}%")
        print(f"  Bounce Rate: {totals.get('bounce_rate', 0):.2f}%")
        print(f"  Mailboxes: {totals.get('mailbox_count', 0):,}")
        print(f"  Workspaces: {totals.get('workspace_count', 0)}")
    
    # Save to static JSON file
    output_path = os.path.join(os.path.dirname(__file__), "static", "data.json")
    
    with open(output_path, "w") as f:
        json.dump(all_data, f, indent=2, default=str)
    
    print(f"\n{'='*60}")
    print(f"Data saved to {output_path}")
    print(f"Generated at: {datetime.now().isoformat()}")
    print(f"{'='*60}")
    
    return all_data


if __name__ == "__main__":
    generate_all_data()
