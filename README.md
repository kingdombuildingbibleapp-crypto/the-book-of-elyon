# The Book of Elyon

A chronological collection of scripture: 82 books ordered by their approximate date of composition, with the KJV (1769, with the 1611 Apocrypha), the Douay-Rheims (Challoner), and R.H. Charles's translations of 1 Enoch and Jubilees. All texts are public domain.

- `data/elyon-data-v1.json` — the source data (books, dates, introductions, text).
- `build.py` — splits the data into `public/data/` (one file per book) for the reader.
- `public/index.html` — the reader: table of contents, continuous page numbers, translations, Greek alternate readings for 1 Enoch.

## Run locally

```bash
python3 build.py
```

```bash
cd public && python3 -m http.server 8080
```

## Deploy

Netlify runs `python3 build.py` and publishes `public/` (see `netlify.toml`).
