// "Ask Me": open conversation about a subject, verse or book.
// Intentionally not cached — every question is different. The limits below
// keep any one request bounded in cost.
import { client, MODEL, FALLBACK, COLLECTION_CONTEXT, textOf, json, errorResponse, plusGate } from "../lib/claude.mjs";

const MAX_TURNS = 12;
const MAX_CHARS = 2000;

const SYSTEM =
  "You are a warm, patient guide answering questions from someone reading scripture, who may be completely new to the Bible or to faith. " +
  "Explain simply and without jargon (define any term you must use). Keep answers concise, roughly 4 to 8 sentences, unless the question truly needs more. " +
  "When it fits naturally, point to one or two specific passages (format: Book Chapter:Verse) that the reader can look up, preferring books in this collection; don't force one in. " +
  "Be encouraging, never preachy or judgmental. Be honest about differing views among Jewish and Christian traditions and between traditional and scholarly readings where they exist. " +
  "Use plain text without markdown headings. Reply in the language the user writes in.\n\n" +
  COLLECTION_CONTEXT;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid request." });
  }

  const denied = await plusGate(req);
  if (denied) return denied;

  const turns = Array.isArray(body?.turns) ? body.turns : [];
  const messages = turns
    .filter((t) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_CHARS) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") return json(400, { error: "Ask a question first." });

  // Optional: where the reader is right now, so "what does this chapter mean?" works.
  const where = typeof body?.context === "string" ? body.context.slice(0, 200) : "";
  const system = where ? `${SYSTEM}\n\nThe reader is currently viewing: ${where}.` : SYSTEM;

  try {
    const response = await client.beta.messages.create({
      ...FALLBACK,
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system,
      messages,
    });
    if (response.stop_reason === "refusal") {
      return json(200, { text: "I'm not able to help with that question. Try asking about a passage, a book, or a theme." });
    }
    return json(200, { text: textOf(response) });
  } catch (err) {
    console.error("ask failed", err);
    return errorResponse(err);
  }
};

export const config = { path: "/api/ask" };
