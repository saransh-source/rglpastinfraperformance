#!/usr/bin/env python3
"""
Full analysis script - Run from native Terminal (not Cursor)
Generates data for all time periods and saves to static/data.json
"""

import json
from datetime import datetime
from analyzer import analyze_all_periods, print_summary

print("=" * 60)
print("RGL INFRA FULL ANALYSIS")
print("=" * 60)
print()
print("This will fetch time-filtered stats for:")
print("  - Google Reseller (GR)")
print("  - Aged Outlook (AO)")
print("  - Legacy Panel (L)")
print("  - Maldoso (MD SMTP)")
print("  - Outlook")
print("  - Winnr SMTP (WR SMTP)")
print("  - Epan (E) - Edu panel")
print()
print("⚠️  This may take 30-60 minutes due to API pagination")
print()

# Run analysis
results = analyze_all_periods()

# Print summary
print_summary(results)

# Save to static JSON file
output_path = "static/data.json"
with open(output_path, "w") as f:
    json.dump(results, f, indent=2, default=str)

print(f"\n{'=' * 60}")
print(f"✅ DATA SAVED to {output_path}")
print(f"Generated at: {datetime.now().isoformat()}")
print(f"{'=' * 60}")
print()
print("To view dashboard:")
print("  1. Run: python3 server.py")
print("  2. Open: http://localhost:5000")
