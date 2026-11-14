// Double-tap verse breakdown, mirroring the Kingdom Building Study Bible's
// verse insights: "simple" (beginner breakdown + related passages) and
// "deeper" (historical and interpretive context).
//
// Each breakdown is generated once and cached in Netlify Blobs, then served
// to every later reader, so a verse is only paid for once.
import { getStore } from "@netlify/blobs";
import { client, MODEL, FALLBACK, COLLECTION_CONTEXT, textOf, json, errorResponse } from "../lib/claude.mjs";

const CACHE_VERSION = "v1"; // bump to regenerate every cached breakdown

const SIMPLE_SCHEMA = {
  type: "object",
  properties: {
    simple: { type: "string" },
    explanation: { type: "string" },
    whyItMatters: { type: "string" },
    keyThemes: { type: "array", items: { type: "string" } },
    relatedVerses: {
      type: "array",
      items: {
        type: "object",
        properties: { ref: { type: "string" }, note: { type: "string" } },
        required: ["ref", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["simple", "explanation", "whyItMatters", "keyThemes", "relatedVerses"],
  additionalProperties: false,
};

const DEEPER_SCHEMA = {
  type: "object",
  properties: { deeper: { type: "string" } },
  required: ["deeper"],
  additionalProperties: false,
};

function context(verses, n) {
  const out = [];
  for (let i = Math.max(0, n - 4); i < Math.min(verses.length, n + 3); i++) out.push(`${i + 1}. ${verses[i]}`);
  return out.join("\n");
}

function prompt(kind, a) {
  const where = `${a.book} ${a.chapter}:${a.verse} — "${a.verseText}" (${a.translationName})`;
  const near = `Nearby verses for context:\n${context(a.chapterVerses, a.verse)}`;
  if (kind === "simple") {
    return (
      "Explain this verse to someone who may have never read scripture before. Write simply and warmly: short sentences, everyday words, " +
      "and if you must use a term like \"grace\" or \"covenant\", explain it in the same sentence. Never sound preachy, judgmental, or academic.\n\n" +
      `The reader double-tapped:\n${where}\n\n${near}\n\n` +
      "Fill each field:\n" +
      "- simple: 1 to 2 very short sentences restating what this verse says in everyday words.\n" +
      "- explanation: 3 to 5 short, plain sentences on what is happening here and why, at about a 7th-grade reading level.\n" +
      "- whyItMatters: 1 to 2 short sentences on how this could matter in an ordinary person's life today.\n" +
      "- keyThemes: 2 to 4 short, plain-language theme words.\n" +
      "- relatedVerses: 3 to 5 real passages for further reading, each with ref formatted exactly like \"John 3:16\" (or \"John 3:16-18\") " +
      "using the book names of this collection, and note as one short sentence on the connection. Prefer passages from this collection; " +
      "they may come from any part of it, including the Apocrypha, 1 Enoch and Jubilees, when relevant."
    );
  }
  return (
    "Go a level deeper than a beginner explanation, for a reader who has the basics and wants more depth on this verse:\n" +
    `${where}\n\n${near}\n\n` +
    "Write deeper as 2 to 4 short paragraphs separated by a blank line, covering historical and literary context, when and by whom scholars think it was written, " +
    "and how different Jewish and Christian traditions and scholars understand this verse. Stay clear and accessible; you may use proper theological terms, " +
    "briefly defining any new one. Note genuine interpretive disagreement where it exists; do not present one view as the only correct one."
  );
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  let b;
  try {
    b = await req.json();
  } catch {
    return json(400, { error: "Invalid request." });
  }

  const kind = b?.kind === "deeper" ? "deeper" : "simple";
  const a = {
    bookId: str(b?.bookId, 8).replace(/[^A-Za-z0-9]/g, ""),
    book: str(b?.book, 60),
    translation: str(b?.translation, 32).replace(/[^A-Za-z0-9-]/g, ""),
    translationName: str(b?.translationName, 160),
    chapter: Number.isInteger(b?.chapter) ? b.chapter : 0,
    verse: Number.isInteger(b?.verse) ? b.verse : 0,
    verseText: str(b?.verseText, 4000),
    chapterVerses: Array.isArray(b?.chapterVerses) ? b.chapterVerses.slice(0, 200).map((v) => str(v, 4000)) : [],
  };
  if (!a.bookId || !a.translation || a.chapter < 1 || a.verse < 1 || !a.verseText) return json(400, { error: "Missing verse details." });

  const key = `${CACHE_VERSION}/${a.translation}/${a.bookId}/${a.chapter}/${a.verse}/${kind}`;
  let store = null;
  try {
    store = getStore("verse-insights");
    const cached = await store.get(key, { type: "json" });
    if (cached) return json(200, cached);
  } catch (err) {
    console.error("cache read failed", err); // fall through and generate
  }

  try {
    const response = await client.beta.messages.create({
      ...FALLBACK,
      model: MODEL,
      max_tokens: 4000,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: kind === "simple" ? SIMPLE_SCHEMA : DEEPER_SCHEMA },
      },
      system:
        "You explain scripture accurately, warmly and even-handedly, respecting both faith traditions and scholarship. " + COLLECTION_CONTEXT,
      messages: [{ role: "user", content: prompt(kind, a) }],
    });
    if (response.stop_reason === "refusal") return json(422, { error: "No explanation is available for this verse." });
    if (response.stop_reason === "max_tokens") return json(502, { error: "The explanation was cut off. Please try again." });

    const payload = JSON.parse(textOf(response));
    try {
      if (store) await store.setJSON(key, payload);
    } catch (err) {
      console.error("cache write failed", err);
    }
    return json(200, payload);
  } catch (err) {
    console.error("verse insight failed", err);
    if (err instanceof SyntaxError) return json(502, { error: "The explanation could not be read. Please try again." });
    return errorResponse(err);
  }
};

export const config = { path: "/api/verse" };
