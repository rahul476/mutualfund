#!/usr/bin/env python3
"""
CAM (Consolidated Account Statement) Image → CSV Extractor & Scheme Classifier

Reads one or more images of a CAM statement table, extracts mutual-fund
holding details via OCR, cleans and categorizes scheme names & fund houses, and writes
them to a structured CSV file.

Usage:
    python cam_extractor.py data/ -o output/cam_holdings.csv
"""

import argparse
import os
import sys
import re
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
import pytesseract
from PIL import Image

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif", ".webp"}

OUTPUT_COLUMNS = [
    "Folio No.",
    "ISIN",
    "Scheme Name",
    "Scheme Code",
    "Fund House",
    "Category",
    "Plan",
    "Option",
    "Cost Value (INR)",
    "Unit Balance",
    "NAV Date",
    "NAV (INR)",
    "Market Value (INR)",
    "Registrar",
]

def preprocess_image(img: np.ndarray, min_width: int = 2400) -> np.ndarray:
    """Enhance image using CLAHE grayscale for maximum OCR accuracy."""
    h, w = img.shape[:2]
    if w < min_width:
        scale = min_width / w
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    if len(img.shape) == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img.copy()

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def clean_isin(isin_str: str) -> str:
    """Clean and normalize OCR ISIN strings."""
    if not isin_str:
        return ""
    s = str(isin_str).upper()
    s = re.sub(r"^[0O1lI|]+(?=INF)", "", s)
    s = re.sub(r"^1(?=NF)", "I", s)
    s = s.replace("O", "0")
    m = re.search(r"INF[A-Z0-9]{9}", s)
    if m:
        return m.group(0)
    return isin_str.strip() if isinstance(isin_str, str) else ""


def extract_fund_house(scheme_name: str) -> str:
    """Extract Mutual Fund House / AMC from scheme name."""
    s = str(scheme_name).upper()
    if "MIRAE" in s: return "Mirae Asset"
    if "PARAG PARIKH" in s or "PPFAS" in s: return "Parag Parikh"
    if "QUANT" in s: return "quant"
    if "TATA" in s: return "Tata"
    if "AXIS" in s: return "Axis"
    if "MOTILAL" in s: return "Motilal Oswal"
    if "NIPPON" in s or "RELIANCE" in s or "RMF" in s: return "Nippon India"
    if "CANARA" in s: return "Canara Robeco"
    if "EDELWEISS" in s: return "Edelweiss"
    if "FRANKLIN" in s: return "Franklin Templeton"
    if "HDFC" in s: return "HDFC"
    if "ICICI" in s: return "ICICI Prudential"
    if "INVESCO" in s: return "Invesco"
    if "KOTAK" in s: return "Kotak"
    if "SBI" in s: return "SBI"
    if "UTI" in s: return "UTI"
    if "ADITYA BIRLA" in s or "BIRLA" in s or "ABSL" in s: return "Aditya Birla Sun Life"
    if "BANDHAN" in s or "IDFC" in s: return "Bandhan"
    if "DSP" in s: return "DSP"
    if "SUNDARAM" in s: return "Sundaram"
    if "HSBC" in s: return "HSBC"
    
    words = str(scheme_name).split()
    return words[0] if words else "Other AMC"


def clean_and_categorize_scheme(scheme_str: str, current_isin: str = "") -> dict:
    """
    Parses, cleans, and categorizes a mutual fund scheme name string.
    """
    if not scheme_str:
        return {
            "ISIN": current_isin,
            "Scheme Code": "",
            "Clean Scheme Name": "",
            "Fund House": "Uncategorized",
            "Category": "Uncategorized",
            "Plan": "Direct",
            "Option": "Growth",
        }

    raw = str(scheme_str).strip()

    # 1. Extract embedded ISIN if present inside scheme string
    isin = current_isin if current_isin and len(str(current_isin)) >= 10 else ""
    isin_match = re.search(r"([0O1lI]?1?NF[A-Z0-9O]{9})", raw, re.IGNORECASE)
    if isin_match:
        found_isin = clean_isin(isin_match.group(1))
        if not isin or len(isin) < 10:
            isin = found_isin
        raw = raw.replace(isin_match.group(0), "", 1).strip()

    # Strip noise prefix symbols e.g. "+ ", "i + ", "0 "
    raw = re.sub(r"^[+—\-+=i\s\d]+(?=[A-Za-z0-9]{4,12}\s*[-–])", "", raw).strip()
    raw = re.sub(r"^[+—\-+=i\s]+", "", raw).strip()
    raw = re.sub(r"^[0O1]\s+(?=[A-Za-z0-9])", "", raw).strip()

    # 2. Extract Plan (Direct vs Regular)
    plan = "Direct"
    if re.search(r"\bREGULAR\b", raw, re.IGNORECASE):
        plan = "Regular"
    elif re.search(r"\bDIRECT\b", raw, re.IGNORECASE):
        plan = "Direct"

    # 3. Extract Option (Growth vs IDCW/Dividend)
    option = "Growth"
    if re.search(r"\b(IDCW|DIVIDEND)\b", raw, re.IGNORECASE):
        option = "IDCW"
    elif re.search(r"\bGROWTH\b", raw, re.IGNORECASE):
        option = "Growth"

    # 4. Extract Scheme Code e.g. "117TSD1G - ", "PP001ZG - ", "P9453 - ", "166IBDGG - "
    scheme_code = ""
    code_match = re.search(r"^([A-Z0-9]{4,12})\s*[-–]\s*", raw)
    if code_match:
        scheme_code = code_match.group(1)
        raw = raw[code_match.end():].strip()

    # 5. Clean Scheme Name
    clean_name = raw
    clean_name = re.sub(r"\(\s*formerly\s+[^)]+\)", "", clean_name, flags=re.IGNORECASE)
    clean_name = re.sub(r"[-–]?\s*DIRECT\s+PLAN.*$", "", clean_name, flags=re.IGNORECASE)
    clean_name = re.sub(r"[-–]?\s*DIRECT\s+GROWTH.*$", "", clean_name, flags=re.IGNORECASE)
    clean_name = re.sub(r"\bDIRECT\b.*$", "", clean_name, flags=re.IGNORECASE)
    clean_name = re.sub(r"\(Non\s*-?\s*Demat\)?", "", clean_name, flags=re.IGNORECASE)
    clean_name = re.sub(r"GROWTH\s+OPTION", "", clean_name, flags=re.IGNORECASE)
    clean_name = re.sub(r"\bGROWTH\b", "", clean_name, flags=re.IGNORECASE)
    clean_name = re.sub(r"[-–\s]+$", "", clean_name).strip()

    clean_name = re.sub(r"^[A-Z0-9]{4,12}\s*[-–]\s*", "", clean_name)
    clean_name = re.sub(r"^[0O1]\s+(?=[A-Za-z])", "", clean_name).strip()
    clean_name = " ".join(clean_name.split())

    fund_house = extract_fund_house(clean_name if clean_name else scheme_str)

    # 6. Assign Category
    cat_lower = (clean_name + " " + scheme_str).lower()

    if "small cap" in cat_lower or "smallcap" in cat_lower:
        category = "Equity: Small Cap"
    elif "mid cap" in cat_lower or "midcap" in cat_lower:
        if "large and mid" in cat_lower or "large & mid" in cat_lower:
            category = "Equity: Large & Mid Cap"
        else:
            category = "Equity: Mid Cap"
    elif "large cap" in cat_lower or "largecap" in cat_lower:
        category = "Equity: Large Cap"
    elif "flexi cap" in cat_lower or "flexicap" in cat_lower:
        category = "Equity: Flexi Cap"
    elif "elss" in cat_lower or "tax saver" in cat_lower:
        category = "Equity: ELSS (Tax Saver)"
    elif "arbitrage" in cat_lower:
        category = "Hybrid: Arbitrage"
    elif "gold" in cat_lower:
        category = "Commodity: Gold"
    elif "silver" in cat_lower:
        category = "Commodity: Silver"
    elif "nifty 50" in cat_lower or ("index" in cat_lower and "nasdaq 100" not in cat_lower and "pharma" not in cat_lower and "midcap150" not in cat_lower):
        category = "Equity: Index"
    elif "fang+" in cat_lower or "us " in cat_lower or "u.s." in cat_lower or "global" in cat_lower or "nasdaq" in cat_lower:
        category = "Equity: International"
    elif "pharma" in cat_lower or "resources" in cat_lower or "energy" in cat_lower or "opportunities" in cat_lower or "midcap150" in cat_lower:
        category = "Equity: Sectoral / Thematic"
    else:
        category = "Equity: Other"

    return {
        "ISIN": isin,
        "Scheme Code": scheme_code,
        "Clean Scheme Name": clean_name,
        "Fund House": fund_house,
        "Category": category,
        "Plan": plan,
        "Option": option,
    }


def parse_row_words(row_words: list) -> dict:
    """
    Parse a single visual line of OCR words using right-to-left semantic token matching.
    """
    line_text = " ".join(w["text"] for w in row_words).strip()
    line_text = re.sub(r",\s+(\d)", r",\1", line_text)
    
    date_match = re.search(r"\b(\d{1,2}-[A-Za-z]{3}-\d{4})\b", line_text)
    if not date_match:
        return None
    
    nav_date = date_match.group(1)
    date_start_idx = date_match.start()
    date_end_idx = date_match.end()
    
    left_part = line_text[:date_start_idx].strip()
    right_part = line_text[date_end_idx:].strip()
    
    registrar = ""
    reg_match = re.search(r"\b(CAMS\.?|KFINTECH|KFIN|KEINTECH|KEINTECEH?)\b", right_part, re.IGNORECASE)
    if reg_match:
        registrar = reg_match.group(1).upper().replace(".", "")
        if "KEIN" in registrar or "KFIN" in registrar:
            registrar = "KFINTECH"
        right_part = right_part[:reg_match.start()].strip()
    
    right_nums = re.findall(r"[\d,]+\.?\d*", right_part)
    right_nums = [n.replace(",", "") for n in right_nums if re.search(r"\d", n)]
    
    nav = ""
    market_value = ""
    if len(right_nums) >= 2:
        nav = right_nums[0]
        market_value = right_nums[1]
    elif len(right_nums) == 1:
        nav = right_nums[0]
        
    left_tokens = left_part.split()
    num_indices = []
    for i in range(len(left_tokens) - 1, -1, -1):
        tok = left_tokens[i].replace(",", "")
        if re.match(r"^\d+(\.\d+)?$", tok):
            num_indices.append(i)
            if len(num_indices) == 2:
                break
    
    cost_val = ""
    unit_bal = ""
    if len(num_indices) == 2:
        unit_idx = num_indices[0]
        cost_idx = num_indices[1]
        unit_bal = left_tokens[unit_idx].replace(",", "")
        cost_val = left_tokens[cost_idx].replace(",", "")
        prefix_tokens = left_tokens[:cost_idx]
    elif len(num_indices) == 1:
        unit_idx = num_indices[0]
        unit_bal = left_tokens[unit_idx].replace(",", "")
        prefix_tokens = left_tokens[:unit_idx]
    else:
        prefix_tokens = left_tokens

    prefix_str = " ".join(prefix_tokens)
    
    if "," in unit_bal and "." not in unit_bal:
        parts = unit_bal.split(",")
        if len(parts) == 2 and len(parts[1]) == 3:
            unit_bal = f"{parts[0]}.{parts[1]}"
    elif "." not in unit_bal and len(unit_bal) > 4:
        unit_bal = f"{unit_bal[:-3]}.{unit_bal[-3:]}"
    
    folio_no = ""
    isin = ""
    
    concat_match = re.search(r"(\d{6,12}(?:/\d+)?)/([0O1lI]?1?NF[A-Z0-9O]{9})", prefix_str, re.IGNORECASE)
    
    if concat_match:
        folio_no = concat_match.group(1)
        isin = clean_isin(concat_match.group(2))
        scheme_name = prefix_str[concat_match.end():].strip()
    else:
        isin_match = re.search(r"\b([0O1lI]?1?NF[A-Z0-9O]{9})\b", prefix_str, re.IGNORECASE)
        folio_match = re.search(r"(\b\d{6,12}(?:/\d+)?\b)", prefix_str)
        
        if isin_match:
            isin = clean_isin(isin_match.group(1))
        
        if folio_match:
            folio_no = folio_match.group(1)
            
        rem = prefix_str
        if folio_no:
            rem = rem.replace(folio_match.group(0), "", 1)
        if isin_match:
            rem = rem.replace(isin_match.group(0), "", 1)
        scheme_name = re.sub(r"^\s*[/,-]\s*", "", rem).strip()
        
    return {
        "Folio No.": folio_no,
        "ISIN": isin,
        "Scheme Name": scheme_name,
        "Cost Value (INR)": cost_val,
        "Unit Balance": unit_bal,
        "NAV Date": nav_date,
        "NAV (INR)": nav,
        "Market Value (INR)": market_value,
        "Registrar": registrar
    }


def extract_from_image(image_path: str) -> pd.DataFrame:
    """Extract CAM holdings from a single image using semantic row parsing."""
    img = cv2.imread(image_path)
    if img is None:
        print(f"  ⚠  Could not read image: {image_path}")
        return pd.DataFrame(columns=OUTPUT_COLUMNS)

    processed = preprocess_image(img)

    config = "--psm 6 --oem 3"
    data = pytesseract.image_to_data(Image.fromarray(processed), config=config, output_type=pytesseract.Output.DICT)
    
    words = []
    for i in range(len(data["text"])):
        text = data["text"][i].strip()
        conf = int(data["conf"][i])
        if text and conf > 15:
            words.append({
                "text": text,
                "x": data["left"][i],
                "y": data["top"][i],
                "w": data["width"][i],
                "h": data["height"][i],
                "y_centre": data["top"][i] + data["height"][i] // 2,
            })
            
    if not words:
        print(f"  ⚠  No text detected in: {image_path}")
        return pd.DataFrame(columns=OUTPUT_COLUMNS)

    words.sort(key=lambda w: w["y_centre"])
    rows = []
    current_row = [words[0]]
    for w in words[1:]:
        avg_h = np.mean([ww["h"] for ww in current_row])
        if abs(w["y_centre"] - np.mean([ww["y_centre"] for ww in current_row])) < avg_h * 0.5:
            current_row.append(w)
        else:
            current_row.sort(key=lambda ww: ww["x"])
            rows.append(current_row)
            current_row = [w]
    if current_row:
        current_row.sort(key=lambda ww: ww["x"])
        rows.append(current_row)
    rows.sort(key=lambda r: np.mean([w["y_centre"] for w in r]))
    
    records = []
    pending_folio = ""
    pending_isin = ""
    
    for r in rows:
        parsed = parse_row_words(r)
        if parsed:
            if pending_folio and not parsed["Folio No."]:
                parsed["Folio No."] = pending_folio
                pending_folio = ""
            if pending_isin and not parsed["ISIN"]:
                parsed["ISIN"] = pending_isin
                pending_isin = ""
            records.append(parsed)
        else:
            line_text = " ".join(w["text"] for w in r).strip()
            if not re.search(r"\btotal\b", line_text, re.IGNORECASE) and not re.search(r"\bfolio\b", line_text, re.IGNORECASE):
                concat_match = re.search(r"(\d{6,12}(?:/\d+)?)/([0O1lI]?1?NF[A-Z0-9O]{9})", line_text, re.IGNORECASE)
                isin_m = re.search(r"\b([0O1lI]?1?NF[A-Z0-9O]{9})\b", line_text, re.IGNORECASE)
                fol_m = re.search(r"(\b\d{6,12}(?:/\d+)?\b)", line_text)
                
                if records:
                    if not records[-1]["Folio No."] or not records[-1]["ISIN"]:
                        if concat_match:
                            if not records[-1]["Folio No."]:
                                records[-1]["Folio No."] = concat_match.group(1)
                            if not records[-1]["ISIN"]:
                                records[-1]["ISIN"] = clean_isin(concat_match.group(2))
                            line_text = line_text[concat_match.end():].strip()
                        else:
                            if isin_m and not records[-1]["ISIN"]:
                                records[-1]["ISIN"] = clean_isin(isin_m.group(1))
                                line_text = line_text.replace(isin_m.group(0), "", 1)
                            if fol_m and not records[-1]["Folio No."]:
                                records[-1]["Folio No."] = fol_m.group(1)
                                line_text = line_text.replace(fol_m.group(0), "", 1)
                    records[-1]["Scheme Name"] = (records[-1]["Scheme Name"] + " " + line_text).strip()
                else:
                    if concat_match:
                        pending_folio = concat_match.group(1)
                        pending_isin = clean_isin(concat_match.group(2))
                    else:
                        if fol_m:
                            pending_folio = fol_m.group(1)
                        if isin_m:
                            pending_isin = clean_isin(isin_m.group(1))

    print(f"   Extracted {len(records)} holdings")
    return pd.DataFrame(records)


def find_images(paths: list) -> list:
    image_files = []
    for p in paths:
        p = Path(p).resolve()
        if p.is_dir():
            for ext in IMAGE_EXTENSIONS:
                image_files.extend(p.glob(f"*{ext}"))
                image_files.extend(p.glob(f"*{ext.upper()}"))
        elif p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS:
            image_files.append(p)

    return [str(f) for f in sorted(set(image_files))]


def extract_all(image_paths: list) -> pd.DataFrame:
    all_dfs = []

    for idx, img_path in enumerate(image_paths, 1):
        print(f"\n📄 [{idx}/{len(image_paths)}] Processing: {Path(img_path).name}")
        df = extract_from_image(img_path)
        if not df.empty:
            df["Source File"] = Path(img_path).name
            all_dfs.append(df)

    if not all_dfs:
        return pd.DataFrame(columns=OUTPUT_COLUMNS + ["Source File"])

    return pd.concat(all_dfs, ignore_index=True)


def clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Normalise, clean, and enrich extracted values with categories, fund houses, and clean scheme names."""
    df = df.copy()

    for col in df.columns:
        df[col] = df[col].astype(str).str.strip()
        df[col] = df[col].str.replace(r"^[=+\-]\s*", "", regex=True)

    clean_schemes = []
    scheme_codes = []
    fund_houses = []
    categories = []
    plans = []
    options = []
    updated_isins = []

    for idx, row in df.iterrows():
        raw_scheme = row.get("Scheme Name", "")
        curr_isin = row.get("ISIN", "")
        res = clean_and_categorize_scheme(raw_scheme, curr_isin)

        updated_isins.append(res["ISIN"])
        clean_schemes.append(res["Clean Scheme Name"])
        scheme_codes.append(res["Scheme Code"])
        fund_houses.append(res["Fund House"])
        categories.append(res["Category"])
        plans.append(res["Plan"])
        options.append(res["Option"])

    df["ISIN"] = updated_isins
    df["Scheme Name"] = clean_schemes
    df["Scheme Code"] = scheme_codes
    df["Fund House"] = fund_houses
    df["Category"] = categories
    df["Plan"] = plans
    df["Option"] = options

    numeric_cols = ["Cost Value (INR)", "Unit Balance", "NAV (INR)", "Market Value (INR)"]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = (
                df[col]
                .str.replace(",", "", regex=False)
                .str.replace(" ", "", regex=False)
            )
            df[col] = pd.to_numeric(df[col], errors="coerce")

    if "NAV Date" in df.columns:
        df["NAV Date"] = df["NAV Date"].str.replace("|", "", regex=False).str.strip()

    if "Registrar" in df.columns:
        df["Registrar"] = df["Registrar"].str.upper().str.strip()

    if "Scheme Name" in df.columns:
        df = df[df["Scheme Name"].str.len() > 3].reset_index(drop=True)
        df = df[~df["Scheme Name"].str.lower().isin(["total", "sub total", "grand total", "sub-total"])].reset_index(drop=True)

    cols_to_use = [c for c in OUTPUT_COLUMNS if c in df.columns]
    if "Source File" in df.columns:
        cols_to_use.append("Source File")

    return df[cols_to_use]


def deduplicate(df: pd.DataFrame) -> pd.DataFrame:
    key_cols = [c for c in OUTPUT_COLUMNS if c in df.columns and c != "Scheme Code"]
    before = len(df)
    df = df.drop_duplicates(subset=key_cols, keep="first").reset_index(drop=True)
    removed = before - len(df)
    if removed > 0:
        print(f"🔄 Removed {removed} duplicate rows across images.")
    return df


def main():
    parser = argparse.ArgumentParser(description="Extract mutual-fund holdings from CAM statement image(s).")
    parser.add_argument("inputs", nargs="+", help="Image file(s) or folder(s)")
    parser.add_argument("-o", "--output", default="output/cam_holdings.csv", help="Output CSV path (default: output/cam_holdings.csv)")
    args = parser.parse_args()

    image_paths = find_images(args.inputs)
    if not image_paths:
        print("❌ No image files found.")
        sys.exit(1)

    print(f"🔎 Found {len(image_paths)} image(s) to process:")

    df = extract_all(image_paths)
    df = clean_dataframe(df)
    df = deduplicate(df)

    if df.empty:
        print("\n⚠  No data could be extracted.")
        sys.exit(1)

    out_path = Path(args.output).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path, index=False)

    print(f"\n{'='*60}")
    print(f"💾 Saved {len(df)} holdings → {out_path}")
    print(f"{'='*60}")
    print(df[["Folio No.", "ISIN", "Scheme Name", "Fund House", "Category", "Plan", "Option", "Market Value (INR)", "Registrar"]].head(10).to_string(index=False))


if __name__ == "__main__":
    main()
