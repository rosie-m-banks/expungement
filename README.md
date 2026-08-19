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
blank and are highlighted for review.

The generated PDF is a draft for attorney review. The user must supply the
current, attorney-verified text of the applicable 22 O.S. Section 18(A)
category; the application does not select or quote statutory language.

Alternatively, check out the web hosted version here: https://expungement.replit.app/
