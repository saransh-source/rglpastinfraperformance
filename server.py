"""
RGL Infra Tracking - Flask Server
Web dashboard and API endpoints
"""

import json
import os
from flask import Flask, render_template, jsonify, request
from config import TIME_PERIODS, INFRA_COSTS, INFRA_MAX_LIMITS, TRACKED_INFRA_TYPES, PROJECTION_INFRA_TYPES

# Get absolute path for templates and static files
import pathlib
BASE_DIR = pathlib.Path(__file__).parent.absolute()

app = Flask(__name__, 
            template_folder=str(BASE_DIR / "templates"),
            static_folder=str(BASE_DIR / "static"))

# Load static data from JSON file
_data_cache = None


def load_static_data() -> dict:
    """Load pre-generated static data from JSON file"""
    global _data_cache
    
    if _data_cache is not None:
        return _data_cache
    
    data_path = os.path.join(os.path.dirname(__file__), "static", "data.json")
    
    if os.path.exists(data_path):
        with open(data_path, "r") as f:
            _data_cache = json.load(f)
    else:
        _data_cache = {}
    
    return _data_cache


def get_analysis(period: str) -> dict:
    """Get analysis results for a period from static data"""
    if period not in TIME_PERIODS:
        period = "14d"
    
    data = load_static_data()
    return data.get(period, {})


def calculate_projections(target_sends: int = 100000) -> dict:
    """
    Calculate cost projections for reaching target sends per day
    Only calculates for PROJECTION_INFRA_TYPES (Maldoso, Google Reseller, Aged Outlook)
    
    Also calculates cost per positive reply based on current performance data.
    """
    projections = {}
    
    # Get current performance data for cost per positive calculation
    data = load_static_data()
    period_data = data.get("14d", {})  # Use 14 day data for positive rate
    by_infra = period_data.get("by_infra", {})
    
    for infra_type in PROJECTION_INFRA_TYPES:
        costs = INFRA_COSTS.get(infra_type, {})
        sends_per_day = costs.get("sends_per_day", INFRA_MAX_LIMITS.get(infra_type, 10))
        
        if sends_per_day <= 0:
            continue
        
        mailboxes_needed = target_sends // sends_per_day
        
        # Calculate monthly cost
        if infra_type == "Aged Outlook":
            # Aged Outlook: $4.22/month for 25 mailboxes (per tenant)
            tenants_needed = mailboxes_needed // costs.get("mailboxes_per_tenant", 25)
            if tenants_needed == 0:
                tenants_needed = 1
            monthly_cost = tenants_needed * costs.get("monthly_per_tenant", 4.22)
            domains_needed = tenants_needed * costs.get("domains_per_tenant", 1)
            
            # One-time: tenant cost + aged domain premium per domain
            setup_cost = (
                tenants_needed * costs.get("tenant_cost", 11.22) +
                domains_needed * costs.get("aged_domain_cost", 7.00)
            )
        else:
            # Maldoso / GR style: monthly per mailbox
            monthly_cost = mailboxes_needed * costs.get("monthly_per_mailbox", 0)
            mailboxes_per_domain = costs.get("mailboxes_per_domain", 4)
            domains_needed = mailboxes_needed // mailboxes_per_domain
            if domains_needed == 0:
                domains_needed = 1
            
            setup_cost = (
                domains_needed * costs.get("domain_cost", 0) +
                mailboxes_needed * costs.get("setup_per_mailbox", 0)
            )
        
        # Calculate cost per positive (excluding one-time setup)
        # Based on: monthly_cost / (positives_per_day * 30)
        infra_data = by_infra.get(infra_type, {})
        positives_per_day = infra_data.get("positives_per_day", 0)
        positive_rate = infra_data.get("positive_rate", 0)  # as percentage (e.g., 0.05 means 0.05%)
        
        # Calculate expected positives per month at target volume
        # positive_rate is percentage, so divide by 100
        if positive_rate > 0:
            expected_positives_per_day = (target_sends * (positive_rate / 100))
            expected_positives_per_month = expected_positives_per_day * 30
            cost_per_positive = monthly_cost / expected_positives_per_month if expected_positives_per_month > 0 else 0
        else:
            cost_per_positive = 0
            expected_positives_per_month = 0
        
        projections[infra_type] = {
            "target_sends": target_sends,
            "sends_per_day": sends_per_day,
            "mailboxes_needed": mailboxes_needed,
            "domains_needed": domains_needed,
            "monthly_cost": round(monthly_cost, 2),
            "setup_cost": round(setup_cost, 2),
            "warmup_weeks": costs.get("warmup_weeks", 4),
            "positive_rate": round(positive_rate, 4),
            "expected_positives_per_month": round(expected_positives_per_month, 1),
            "cost_per_positive": round(cost_per_positive, 2),
        }
    
    return projections


@app.route("/")
def dashboard():
    """Render the main dashboard"""
    return render_template("index.html")


@app.route("/api/analyze")
def api_analyze():
    """
    API endpoint to get analysis results
    
    Query params:
        period: "3d", "7d", "14d", "30d" (default: "14d")
    """
    period = request.args.get("period", "14d")
    
    try:
        results = get_analysis(period)
        if not results:
            return jsonify({"error": "No data available. Run run_full_analysis.py first."}), 404
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/infra")
def api_infra():
    """Get infra comparison data only"""
    period = request.args.get("period", "14d")
    
    try:
        results = get_analysis(period)
        return jsonify({
            "by_infra": results.get("by_infra", {}),
            "totals": results.get("totals", {}),
            "meta": results.get("meta", {}),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/workspaces")
def api_workspaces():
    """Get workspace breakdown data"""
    period = request.args.get("period", "14d")
    
    try:
        results = get_analysis(period)
        return jsonify({
            "by_workspace": results.get("by_workspace", {}),
            "by_client": results.get("by_client", {}),
            "meta": results.get("meta", {}),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/projections")
def api_projections():
    """Get cost projections for 100k sends/day"""
    try:
        # Always calculate fresh to include cost per positive
        projections = calculate_projections(100000)
        return jsonify(projections)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/refresh")
def api_refresh():
    """Reload static data from file"""
    global _data_cache
    _data_cache = None
    load_static_data()
    return jsonify({"status": "ok", "message": "Data reloaded from file"})


if __name__ == "__main__":
    print("Starting RGL Infra Tracking Dashboard...")
    print("Open http://localhost:5000 in your browser")
    app.run(debug=True, port=5000)
