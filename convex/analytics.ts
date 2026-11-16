import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { isOwnerUser } from "./lib/owner";

// Simple, private site analytics for the owner page. The page sends a page
// view with a random id kept in that browser (no name, email or cookie), so
// we can count views, daily visitors and new visitors. Nothing here can be
// linked to a person, and the owner's own visits are not counted.

const SHARDS = 4;
const PAGES = ["cover", "contents", "references", "credits", "read", "today", "plans", "plan", "topics", "topic", "notes", "plus", "gift", "privacy", "terms"];
const EVENTS = ["ask", "verse", "verse-deeper", "signup", "checkout"];

async function bump(ctx: MutationCtx, date: string, key: string, by = 1) {
  const shard = Math.floor(Math.random() * SHARDS);
  const day = await ctx.db
    .query("dailyCounts")
    .withIndex("by_date_and_key_and_shard", (q) => q.eq("date", date).eq("key", key).eq("shard", shard))
    .unique();
  if (day) await ctx.db.patch("dailyCounts", day._id, { count: day.count + by });
  else await ctx.db.insert("dailyCounts", { date, key, shard, count: by });
  const total = await ctx.db
    .query("totalCounts")
    .withIndex("by_key_and_shard", (q) => q.eq("key", key).eq("shard", shard))
    .unique();
  if (total) await ctx.db.patch("totalCounts", total._id, { count: total.count + by });
  else await ctx.db.insert("totalCounts", { key, shard, count: by });
}

/** Records a page view (and optionally an event such as an Ask Me question). */
export const track = mutation({
  args: { visitor: v.string(), page: v.string(), book: v.optional(v.string()), event: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { visitor, page, book, event }) => {
    if (!/^[a-z0-9]{16,40}$/.test(visitor)) return null;
    const userId = await getAuthUserId(ctx);
    if (userId && (await isOwnerUser(ctx, userId))) return null; // don't count the owner
    const date = new Date().toISOString().slice(0, 10);
    if (event) {
      if (EVENTS.includes(event)) await bump(ctx, date, `event:${event}`);
      return null;
    }
    if (!PAGES.includes(page)) return null;
    await bump(ctx, date, "view");
    await bump(ctx, date, `page:${page}`);
    if (book && /^[A-Z0-9]{2,4}$/.test(book)) await bump(ctx, date, `book:${book}`);
    const seenToday = await ctx.db
      .query("visitorDays")
      .withIndex("by_date_and_visitor", (q) => q.eq("date", date).eq("visitor", visitor))
      .unique();
    if (!seenToday) {
      await ctx.db.insert("visitorDays", { date, visitor });
      await bump(ctx, date, "visit");
      const known = await ctx.db.query("visitors").withIndex("by_visitor", (q) => q.eq("visitor", visitor)).unique();
      if (!known) {
        await ctx.db.insert("visitors", { visitor, firstSeen: date });
        await bump(ctx, date, "newVisitor");
      }
    }
    return null;
  },
});

const periodValidator = v.object({
  views: v.number(),
  visits: v.number(),
  newVisitors: v.number(),
  signups: v.number(),
  paid: v.number(),
  revenueCents: v.number(),
  freeGiven: v.number(),
  asks: v.number(),
  verses: v.number(),
  pages: v.array(v.object({ key: v.string(), count: v.number() })),
  books: v.array(v.object({ key: v.string(), count: v.number() })),
});

function day(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The owner's analytics. `now` comes from the page (queries can't read the
 * clock). Returns 7, 30 and 90-day periods, all time, and a daily series.
 */
export const overview = query({
  args: { now: v.number() },
  returns: v.object({
    periods: v.object({ d7: periodValidator, d30: periodValidator, d90: periodValidator, all: periodValidator }),
    daily: v.array(v.object({ date: v.string(), views: v.number(), visits: v.number() })),
    totals: v.object({ accounts: v.number(), plus: v.number(), notes: v.number(), activePlans: v.number(), since: v.union(v.string(), v.null()) }),
  }),
  handler: async (ctx, { now }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await isOwnerUser(ctx, userId))) throw new Error("Only the site owner can see analytics.");

    const start90 = day(now - 89 * 864e5);
    const rows = await ctx.db
      .query("dailyCounts")
      .withIndex("by_date_and_key_and_shard", (q) => q.gte("date", start90))
      .take(15000);
    const totals = await ctx.db.query("totalCounts").take(4000);
    const users = await ctx.db.query("users").order("desc").take(10000);
    const purchases = await ctx.db.query("purchases").take(10000);

    const sum = (since: string | null) => {
      const m = new Map<string, number>();
      if (since === null) for (const t of totals) m.set(t.key, (m.get(t.key) ?? 0) + t.count);
      else for (const r of rows) if (r.date >= since) m.set(r.key, (m.get(r.key) ?? 0) + r.count);
      const pick = (prefix: string) =>
        [...m].filter(([k]) => k.startsWith(prefix)).map(([k, count]) => ({ key: k.slice(prefix.length), count })).sort((a, b) => b.count - a.count);
      const sinceMs = since === null ? 0 : Date.parse(since + "T00:00:00Z");
      const bought = purchases.filter((p) => p.paidAt >= sinceMs);
      const paid = bought.filter((p) => p.sessionId.startsWith("cs_"));
      return {
        views: m.get("view") ?? 0,
        visits: m.get("visit") ?? 0,
        newVisitors: m.get("newVisitor") ?? 0,
        signups: users.filter((u) => u._creationTime >= sinceMs).length,
        paid: paid.length,
        revenueCents: paid.reduce((n, p) => n + p.amount, 0),
        freeGiven: bought.length - paid.length,
        asks: m.get("event:ask") ?? 0,
        verses: (m.get("event:verse") ?? 0) + (m.get("event:verse-deeper") ?? 0),
        pages: pick("page:"),
        books: pick("book:").slice(0, 10),
      };
    };

    const byDay = new Map<string, { views: number; visits: number }>();
    for (let i = 89; i >= 0; i--) byDay.set(day(now - i * 864e5), { views: 0, visits: 0 });
    for (const r of rows) {
      const d = byDay.get(r.date);
      if (!d) continue;
      if (r.key === "view") d.views += r.count;
      if (r.key === "visit") d.visits += r.count;
    }

    const notes = await ctx.db.query("notes").take(20000);
    const plans = await ctx.db.query("planEnrollments").take(20000);
    const firstDay = await ctx.db.query("dailyCounts").withIndex("by_date_and_key_and_shard").first();
    return {
      periods: { d7: sum(day(now - 6 * 864e5)), d30: sum(day(now - 29 * 864e5)), d90: sum(start90), all: sum(null) },
      daily: [...byDay].map(([date, d]) => ({ date, ...d })),
      totals: { accounts: users.length, plus: purchases.length, notes: notes.length, activePlans: plans.length, since: firstDay?.date ?? null },
    };
  },
});
