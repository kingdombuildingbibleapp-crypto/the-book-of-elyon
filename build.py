"""Build the static site's data from elyon-data-v1.json.

Usage: python3 build.py [path/to/elyon-data-v1.json]
Writes public/data/index.json (book list + translations) and
public/data/books/<ID>.json (one file per book).
"""
import json, os, sys, shutil

here = os.path.dirname(os.path.abspath(__file__))
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "data", "elyon-data-v1.json")
d = json.load(open(src, encoding="utf-8"))

out = os.path.join(here, "public", "data")
shutil.rmtree(out, ignore_errors=True)
os.makedirs(os.path.join(out, "books"))

index = {k: d[k] for k in ("title", "version", "text", "translations")}
index["books"] = []
base_note = ""  # notes reading "Same" refer to the previous book's source; spell it out for readers
page = 1  # continuous page numbering: one page per chapter of each book's first translation
for b in d["books"]:
    meta = {k: v for k, v in b.items() if k != "translations"}
    meta["translations"] = {k: len(v["chapters"]) for k, v in b["translations"].items()}
    note = meta.get("dateNote") or ""
    if note.lower().startswith("same") and base_note:
        meta["dateNote"] = base_note + note[4:]
    else:
        base_note = note
    meta["page"] = page
    page += next(iter(meta["translations"].values()))
    index["books"].append(meta)
    with open(os.path.join(out, "books", b["id"] + ".json"), "w", encoding="utf-8") as f:
        json.dump(b["translations"], f, ensure_ascii=False, separators=(",", ":"))
index["pages"] = page - 1
with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
    json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
print(f"built {len(index['books'])} books, {index['pages']} pages -> {out}")
