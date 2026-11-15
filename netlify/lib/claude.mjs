// Shared Claude setup for the Elyon AI features.
//
// The API key lives only on the server: set ANTHROPIC_API_KEY in Netlify
// (Site configuration → Environment variables). Never put it in the page.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";

// Same model as the Kingdom Building Study Bible.
export const MODEL = "claude-sonnet-5-5";

export const client = new Anthropic(); // reads ANTHROPIC_API_KEY

// Book names in this collection, so related-passage suggestions use books a
// reader can actually open here.
let bookNames = [];
try {
  const idx = JSON.parse(readFileSync(new URL("../../public/data/index.json", import.meta.url), "utf8"));
  bookNames = idx.books.map((b) => b.name);
} catch {
  bookNames = [];
}
export const BOOK_NAMES = bookNames;

export const COLLECTION_CONTEXT =
  "The reader is using The Book of Elyon, a collection of scripture arranged in the order scholars believe the books were written. " +
  "It contains the Hebrew Bible, the Apocrypha (deuterocanonical books), 1 Enoch, Jubilees and the New Testament, in the King James Version, " +
  "the Douay-Rheims, and R.H. Charles's translations of 1 Enoch and Jubilees." +
  (bookNames.length ? ` The books in this collection are: ${bookNames.join(", ")}.` : "");

// Server-side fallback on a policy decline, routed by refusal category.
export const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

export function textOf(message) {
  return (message.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Map SDK errors to a short message the page can show, without leaking details.
export function errorResponse(err) {
  if (err instanceof Anthropic.AuthenticationError) return json(500, { error: "The AI service is not configured yet." });
  if (err instanceof Anthropic.RateLimitError) return json(429, { error: "Too many requests right now. Please try again in a minute." });
  if (err instanceof Anthropic.BadRequestError) return json(400, { error: "That request could not be processed." });
  if (err instanceof Anthropic.APIError) return json(502, { error: "The AI service had a problem. Please try again." });
  if (err instanceof Anthropic.APIConnectionError) return json(502, { error: "Could not reach the AI service. Please try again." });
  return json(500, { error: "Something went wrong." });
}

// Elyon Plus: Ask Me and verse breakdowns are for readers who bought the
// upgrade. The page sends the reader's sign-in token; Convex checks it and
// looks up the purchase (convex/billing.ts). Returns an error Response, or
// null when the reader may continue.
const CONVEX_URL = process.env.CONVEX_URL || "https://resolute-anteater-719.convex.cloud";
export async function plusGate(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "");
  if (!m) return json(401, { error: "Sign in with Elyon Plus to use this.", plus: false });
  try {
    const convex = new ConvexHttpClient(CONVEX_URL);
    convex.setAuth(m[1]);
    if (await convex.query("billing:hasPlus", {})) return null;
    return json(402, { error: "This is part of Elyon Plus.", plus: false });
  } catch (err) {
    // An expired or invalid token: the page refreshes it and tries again.
    if (/auth|token|jwt/i.test(String(err && err.message))) return json(401, { error: "Please sign in again.", plus: false });
    console.error("plus check failed", err);
    return json(502, { error: "Could not check your Elyon Plus access. Please try again." });
  }
}
