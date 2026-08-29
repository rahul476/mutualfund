#!/usr/bin/env python3
"""
CAM Statement Web Application Server

Serves the interactive web interface and provides REST API endpoints for
in-memory image upload, OCR extraction, categorization, analytics summary,
custom target goal CRUD, and CSV export.

Usage:
    python server.py [port]
"""

import http.server
import socketserver
import json
import os
import sys
import re
import urllib.parse
from pathlib import Path
import pandas as pd

# Import extractor pipeline
from cam_extractor import extract_all, clean_dataframe, deduplicate, OUTPUT_COLUMNS, PDFPasswordRequiredError

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5050
OUTPUT_DIR = Path("output").resolve()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
GOALS_FILE = Path("target_goals.json").resolve()

DEFAULT_GOALS = [
    {
        "key": "parag_parikh",
        "name": "Parag Parikh Flexi Cap Fund",
        "category": "Equity: Flexi Cap",
        "targetPct": 35.0,
        "keywords": ["parag parikh flexi"]
    },
    {
        "key": "icici_opp",
        "name": "ICICI Pru India Opp Fund",
        "category": "Equity: Sectoral / Thematic",
        "targetPct": 20.0,
        "keywords": ["icici prudential india opportunities", "icici pru india opp"]
    },
    {
        "key": "hdfc_midcap",
        "name": "HDFC Midcap Fund",
        "category": "Equity: Mid Cap",
        "targetPct": 20.0,
        "keywords": ["hdfc mid cap", "hdfc midcap"]
    },
    {
        "key": "quant_smallcap",
        "name": "Quant Small Cap Fund",
        "category": "Equity: Small Cap",
        "targetPct": 15.0,
        "keywords": ["quant small cap", "quant smallcap"]
    },
    {
        "key": "icici_gold",
        "name": "ICICI Pru Gold ETF FOF",
        "category": "Commodity: Gold",
        "targetPct": 5.0,
        "keywords": ["icici prudential gold", "icici pru gold"]
    },
    {
        "key": "icici_silver",
        "name": "ICICI Pru Silver ETF FOF",
        "category": "Commodity: Silver",
        "targetPct": 5.0,
        "keywords": ["icici prudential silver", "icici pru silver"]
    }
]


def load_target_goals() -> list:
    """Load target goals from target_goals.json document or return defaults."""
    if GOALS_FILE.exists():
        try:
            with open(GOALS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠ Warning loading {GOALS_FILE}: {e}")
    
    # Save default if not exists
    save_target_goals(DEFAULT_GOALS)
    return DEFAULT_GOALS


def save_target_goals(goals: list) -> bool:
    """Save target goals list to target_goals.json document."""
    try:
        with open(GOALS_FILE, "w", encoding="utf-8") as f:
            json.dump(goals, f, indent=2)
        return True
    except Exception as e:
        print(f"❌ Error saving goals to {GOALS_FILE}: {e}")
        return False


def parse_multipart_files_in_memory(body: bytes, boundary: bytes) -> tuple:
    """Parse multipart/form-data into (in_memory_files, form_fields)."""
    parts = body.split(b"--" + boundary)
    in_memory_files = []
    form_fields = {}
    
    for part in parts:
        if not part or part == b"--\r\n" or part == b"--":
            continue
        
        headers_end = part.find(b"\r\n\r\n")
        if headers_end == -1:
            continue
            
        header_bytes = part[:headers_end]
        content = part[headers_end + 4:-2]
        
        header_str = header_bytes.decode("utf-8", errors="ignore")
        fn_match = re.search(r'filename="([^"]+)"', header_str)
        name_match = re.search(r'name="([^"]+)"', header_str)
        
        if fn_match and content:
            filename = Path(fn_match.group(1)).name
            if filename:
                in_memory_files.append((filename, content))
        elif name_match and not fn_match:
            field_name = name_match.group(1)
            form_fields[field_name] = content.decode("utf-8", errors="ignore").strip()
                
    return in_memory_files, form_fields


def calculate_analytics(df: pd.DataFrame) -> dict:
    """Calculate portfolio summary analytics from extracted DataFrame."""
    if df.empty:
        return {
            "total_holdings": 0,
            "total_cost": 0.0,
            "total_market_value": 0.0,
            "total_gain_loss": 0.0,
            "total_gain_loss_pct": 0.0,
            "categories": {},
            "fund_houses": {},
            "registrars": {},
        }
        
    cost = pd.to_numeric(df.get("Cost Value (INR)", 0), errors="coerce").fillna(0).sum()
    market_val = pd.to_numeric(df.get("Market Value (INR)", 0), errors="coerce").fillna(0).sum()
    gain_loss = market_val - cost
    gain_loss_pct = (gain_loss / cost * 100) if cost > 0 else 0.0
    
    cat_dist = {}
    if "Category" in df.columns:
        cat_grouped = df.groupby("Category")["Market Value (INR)"].sum()
        for cat, val in cat_grouped.items():
            if pd.notna(val) and val > 0:
                cat_dist[str(cat)] = round(float(val), 2)

    amc_dist = {}
    if "Fund House" in df.columns:
        amc_grouped = df.groupby("Fund House")["Market Value (INR)"].sum()
        for amc, val in amc_grouped.items():
            if pd.notna(val) and val > 0:
                amc_dist[str(amc)] = round(float(val), 2)
                
    reg_dist = {}
    if "Registrar" in df.columns:
        reg_grouped = df.groupby("Registrar")["Market Value (INR)"].sum()
        for reg, val in reg_grouped.items():
            if pd.notna(val) and val > 0:
                reg_dist[str(reg)] = round(float(val), 2)
                
    return {
        "total_holdings": len(df),
        "total_cost": round(float(cost), 2),
        "total_market_value": round(float(market_val), 2),
        "total_gain_loss": round(float(gain_loss), 2),
        "total_gain_loss_pct": round(float(gain_loss_pct), 2),
        "categories": cat_dist,
        "fund_houses": amc_dist,
        "registrars": reg_dist,
    }


class CAMServerHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        
        if parsed_url.path == "/api/goals":
            goals = load_target_goals()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "goals": goals}).encode("utf-8"))
            return

        if parsed_url.path == "/api/sample":
            sample_csv = OUTPUT_DIR / "cam_holdings.csv"
            goals = load_target_goals()
            if sample_csv.exists():
                df = pd.read_csv(sample_csv)
                analytics = calculate_analytics(df)
                records = df.fillna("").to_dict(orient="records")
                res = {
                    "success": True,
                    "summary": analytics,
                    "holdings": records,
                    "goals": goals,
                    "download_url": "/output/cam_holdings.csv",
                }
            else:
                res = {
                    "success": False,
                    "message": "No sample file found.",
                    "goals": goals,
                }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))
            return
            
        return super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        
        if parsed_url.path == "/api/clear":
            try:
                if OUTPUT_DIR.exists():
                    for f in OUTPUT_DIR.glob("*"):
                        if f.is_file():
                            try:
                                os.remove(f)
                            except Exception as fe:
                                print(f"⚠ Warning removing file {f}: {fe}")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "message": "All CSV data and extracted portfolio state cleared."}).encode("utf-8"))
            except Exception as e:
                print(f"❌ Error clearing data: {e}")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        if parsed_url.path == "/api/goals":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode("utf-8"))
                new_goals = data.get("goals", [])
                if save_target_goals(new_goals):
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": True, "goals": new_goals}).encode("utf-8"))
                else:
                    self.send_response(500)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": "Failed to write target_goals.json"}).encode("utf-8"))
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return

        if parsed_url.path == "/api/extract":
            content_type = self.headers.get("Content-Type", "")
            if not content_type.startswith("multipart/form-data"):
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Invalid Content-Type"}).encode("utf-8"))
                return
                
            boundary_match = re.search(r"boundary=(.+)", content_type)
            if not boundary_match:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "No boundary found"}).encode("utf-8"))
                return
                
            boundary = boundary_match.group(1).encode("utf-8")
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            
            in_memory_files, form_fields = parse_multipart_files_in_memory(body, boundary)
            if not in_memory_files:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "No valid image or PDF files uploaded"}).encode("utf-8"))
                return
                
            pdf_password = form_fields.get("password", None)
            print(f"🔎 Server processing {len(in_memory_files)} uploaded file(s) completely IN-MEMORY (password provided: {bool(pdf_password)})...")
            
            try:
                df = extract_all(in_memory_files, password=pdf_password)
                df = clean_dataframe(df)
                df = deduplicate(df)
                
                out_path = OUTPUT_DIR / "cam_holdings.csv"
                df.to_csv(out_path, index=False)
                
                analytics = calculate_analytics(df)
                records = df.fillna("").to_dict(orient="records")
                goals = load_target_goals()
                
                res = {
                    "success": True,
                    "summary": analytics,
                    "holdings": records,
                    "goals": goals,
                    "download_url": "/output/cam_holdings.csv",
                }
                
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(res).encode("utf-8"))
                
            except PDFPasswordRequiredError as e:
                print(f"🔒 PDF Password Required: {e}")
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": False,
                    "password_required": True,
                    "error": "PDF is password-protected. Please enter your password (e.g., PAN or DOB)."
                }).encode("utf-8"))
            except Exception as e:
                print(f"❌ Extraction error: {e}")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
            return


def run_server():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CAMServerHandler) as httpd:
        print(f"🚀 CAM Statement Web Server running at: http://localhost:{PORT}")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
            httpd.server_close()


if __name__ == "__main__":
    run_server()
