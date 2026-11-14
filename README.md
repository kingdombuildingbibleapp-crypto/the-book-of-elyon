# The Book of Elyon

A chronological collection of scripture: 82 books ordered by their approximate date of composition, with the KJV (1769, with the 1611 Apocrypha), the Douay-Rheims (Challoner), and R.H. Charles's translations of 1 Enoch and Jubilees. All texts are public domain.

- `data/elyon-data-v1.json` — the source data (books, dates, introductions, text).
- `build.py` — splits the data into `public/data/` (one file per book) for the reader.
- `public/index.html` — the reader: cover, contents, references and credits; continuous page numbers; translations; Greek alternate readings for 1 Enoch; the **Ask Me** chat and **double-tap verse breakdowns**.
- `netlify/functions/` — the AI endpoints (`/api/ask`, `/api/verse`), calling Claude Sonnet 5.5 through the Anthropic SDK. Verse breakdowns are cached in Netlify Blobs, so each verse is generated once.

## AI setup

Add `ANTHROPIC_API_KEY` in Netlify under Site configuration → Environment variables (scope: Functions, mark as secret). The key never reaches the browser.

## Run locally

```bash
python3 build.py
```

```bash
cd public && python3 -m http.server 8080
```

## Deploy

Netlify runs `python3 build.py`, publishes `public/`, and bundles `netlify/functions/` (see `netlify.toml`). Run `npm install` first when deploying from your own machine.
