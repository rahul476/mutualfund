# 📊 Mutual Fund CAM Statement Extractor & Web Analytics Dashboard

An end-to-end mutual fund Consolidated Account Statement (CAM) extraction system featuring high-accuracy OCR image scraping, scheme cleaning, asset categorization, and a modern web dashboard.

![Web App Preview](output/cam_holdings.csv)

## Features

- **Web Dashboard**:
  - **Drag & Drop Upload**: Upload multi-page CAM statement screenshots (`.png`, `.jpg`, `.jpeg`, `.webp`).
  - **Portfolio Metrics**: Real-time Total Valuation, Investment Cost, Unrealized Profit/Loss (INR & %), and Holdings Count.
  - **Asset Allocation Analytics**: Interactive Chart.js Donut & Bar charts breaking down holdings by **Category** and **Registrar / RTA**.
  - **Interactive Data Table**: Search bar, category filter pills, dynamic column sorting, and instant **Export CSV Report**.
- **OCR Extraction Pipeline**:
  - Contrast-Limited Adaptive Histogram Equalization (CLAHE) pre-processing via OpenCV.
  - Tesseract OCR word bounding-box extraction (`pytesseract`).
  - Semantic right-to-left line token parsing.
- **Scheme Name Cleaning & Categorization (`clean_and_categorize_scheme`)**:
  - Extracts embedded ISIN codes and removes OCR prefix noise.
  - Isolates **Scheme Code** (e.g. `117TSD1G`, `PP001ZG`).
  - Generates clean, human-readable **Scheme Name**.
  - Identifies **Plan** (`Direct` / `Regular`) and **Option** (`Growth` / `IDCW`).
  - Automatically classifies funds into **Categories**:
    - `Equity: Small Cap`, `Equity: Mid Cap`, `Equity: Large & Mid Cap`, `Equity: Flexi Cap`, `Equity: ELSS (Tax Saver)`, `Equity: Index`, `Equity: International`, `Equity: Sectoral / Thematic`
    - `Hybrid: Arbitrage`
    - `Commodity: Gold`, `Commodity: Silver`

## Quick Start

### 1. Launch Web Application

```bash
# Start the web server (default port: 5050)
python server.py 5050
```

Open your browser and navigate to: **`http://localhost:5050`**

### 2. Command-Line Extraction (CLI)

```bash
# Run extractor directly on input directory (outputs to output/cam_holdings.csv)
python cam_extractor.py data/
```

### 3. Python API / Standalone Cleaning

```python
from cam_extractor import clean_and_categorize_scheme

raw_scheme = "OINF769KO1DM9 117TSD1G - Mirae Asset ELSS Tax Saver Fund (formerly Mirae Asset Tax Saver Fund ) - Direct Plan (Non Demat)"
res = clean_and_categorize_scheme(raw_scheme)

print(res)
# Output:
# {
#     'ISIN': 'INF769K01DM9',
#     'Scheme Code': '117TSD1G',
#     'Clean Scheme Name': 'Mirae Asset ELSS Tax Saver Fund',
#     'Category': 'Equity: ELSS (Tax Saver)',
#     'Plan': 'Direct',
#     'Option': 'Growth'
# }
```
