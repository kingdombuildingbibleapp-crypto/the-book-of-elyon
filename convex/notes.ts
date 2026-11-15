import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./lib/auth";
import { getAuthUserId } from "@convex-dev/auth/server";

const MAX_NOTE = 5000;

const noteValidator = v.object({
  bookId: v.string(),
  chapter: v.number(),
  verse: v.number(),
  text: v.string(),
  updatedAt: v.number(),
});

function cleanBookId(bookId: string): string {
  const id = bookId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
  if (!id) throw new Error("Unknown book.");
  return id;
}

function checkPlace(chapter: number, verse: number) {
  if (!Number.isInteger(chapter) || !Number.isInteger(verse) || chapter < 1 || verse < 1 || chapter > 200 || verse > 200) {
    throw new Error("Unknown verse.");
  }
}

/** The reader's notes, newest first (up to 500), or [] when signed out. */
export const mine = query({
  args: {},
  returns: v.array(noteValidator),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("notes")
      .withIndex("by_userId_and_updatedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(500);
    return rows.map(({ bookId, chapter, verse, text, updatedAt }) => ({ bookId, chapter, verse, text, updatedAt }));
  },
});

/** Saves the note on a verse; empty text deletes it. */
export const save = mutation({
  args: { bookId: v.string(), chapter: v.number(), verse: v.number(), text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const bookId = cleanBookId(args.bookId);
    checkPlace(args.chapter, args.verse);
    const text = args.text.trim().slice(0, MAX_NOTE);
    const existing = await ctx.db
      .query("notes")
      .withIndex("by_userId_and_bookId_and_chapter_and_verse", (q) =>
        q.eq("userId", userId).eq("bookId", bookId).eq("chapter", args.chapter).eq("verse", args.verse),
      )
      .unique();
    if (!text) {
      if (existing) await ctx.db.delete("notes", existing._id);
      return null;
    }
    const doc = { userId, bookId, chapter: args.chapter, verse: args.verse, text, updatedAt: Date.now() };
    if (existing) await ctx.db.replace("notes", existing._id, doc);
    else await ctx.db.insert("notes", doc);
    return null;
  },
});
