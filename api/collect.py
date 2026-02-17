"""
Vercel Serverless Function for Daily Data Collection
Triggered by Vercel Cron at 4:30 PM IST (11:00 UTC)

Endpoint: GET /api/collect
"""
import sys
import os
import json
from http.server import BaseHTTPRequestHandler

# Add parent directory to path so we can import our modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase_data_collector import collect_and_store


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        """Handle GET request - run data collection"""
        try:
            # Run the data collection
            result = collect_and_store()

            # Return success response
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'status': 'success',
                'message': 'Data collection completed',
                'result': result
            }).encode())

        except Exception as e:
            # Return error response
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'status': 'error',
                'message': str(e)
            }).encode())
