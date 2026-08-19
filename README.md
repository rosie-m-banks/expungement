# Expungement screening for lawyers in Oklahoma
How to use: 

```
pip install -r requirements.txt

export GEMINI_API_KEY="your_api_key"

python web_server.py
```

## Petition generator

Open `http://127.0.0.1:5000/petition.html` to test the petition workflow without
running a screening. Eligible case cards also show a **Generate Petition**
button after analysis. The form supports filed criminal cases, gubernatorial
pardons, arrest/no-file matters, and multiple-case joinder.

When opened from completed eligibility results, the generator automatically
imports every eligible case and arrest from that screening session. Imported
facts are prefilled, while petition-only or legally ambiguous fields remain
blank and are highlighted for review. On the static GitHub Pages build, this
prefill is created directly from the screening data saved in the browser;
petition PDF generation still requires the Python web server.

The generated PDF is a draft for attorney review. When a screening verdict
matches a configured 22 O.S. Section 18(A) authority, the category and language
are prefilled; unmapped authorities remain blank. The user must verify every
category and the current statutory text before generating or filing a petition.

Alternatively, check out the web hosted version here: https://expungement.replit.app/
