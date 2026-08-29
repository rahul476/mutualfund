# 📊 Mutual Fund CAS Statement Extractor & Analytics Dashboard

Extract mutual fund Consolidated Account Statements (CAS PDFs or screenshot images) into clean CSV data, categorized analytics, and an interactive web dashboard.

## 🚀 Quick Start

```bash
# Start the web dashboard (http://localhost:5050)
python server.py 5050

# Or run CLI extraction directly on a PDF or image folder
python cam_extractor.py statement.pdf -p YOUR_PAN -o output/cam_holdings.csv
```

## 📥 How to Download your CAS PDF

1. Visit [CAMS CAS Portal](https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement) or [KFintech CAS Portal](https://mfs.kfintech.com/investor/General/ConsolidatedAccountStatement).
2. Request a **Summary CAS** statement to your registered email.
3. Drag & drop the PDF into the Web App (enter your PAN or DOB password when prompted).

## ✨ Key Features

- **PDF & Image Parsing**: Extracts password-protected CAMS / KFintech CAS PDFs and image screenshots.
- **Automatic Categorization**: Classifies schemes into Equity (Small, Mid, Flexi, ELSS, Index), Hybrid, Commodities (Gold/Silver), and AMC Fund Houses.
- **Target Goal Tracker**: Set target allocation percentages and track portfolio rebalancing.
- **Export & Analytics**: Real-time valuation metrics, allocation charts, and 1-click CSV export.
