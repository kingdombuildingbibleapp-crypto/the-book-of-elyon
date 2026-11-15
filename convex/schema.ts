import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

const kind = v.union(v.literal("word"), v.literal("worship"));

export default defineSchema({
  // Accounts, sessions and sign-in tokens (Convex Auth).
  ...authTables,

  // A reader's note on a verse. Notes belong to the verse, not to a
  // translation, so they show in every translation of that verse.
  notes: defineTable({
    userId: v.id("users"),
    bookId: v.string(),
    chapter: v.number(),
    verse: v.number(),
    text: v.string(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_updatedAt", ["userId", "updatedAt"])
    .index("by_userId_and_bookId_and_chapter_and_verse", ["userId", "bookId", "chapter", "verse"]),

  // Elyon Plus purchases (billing.ts), one row per paid Stripe Checkout.
  purchases: defineTable({
    userId: v.id("users"),
    product: v.literal("plus"),
    // Stripe Checkout session id, or "gift:<code>:<userId>" / "owner:<userId>"
    // for free access given by the owner (owner.ts).
    sessionId: v.string(),
    amount: v.number(), // cents
    currency: v.string(),
    paidAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_sessionId", ["sessionId"]),

  // Free Elyon Plus links the owner shares (owner.ts).
  giftLinks: defineTable({
    code: v.string(),
    label: v.string(),
    maxUses: v.union(v.number(), v.null()), // null = unlimited
    uses: v.number(),
    active: v.boolean(),
    createdAt: v.number(),
  }).index("by_code", ["code"]),

  // Study plans a reader has started (plans themselves are in planCatalog.ts).
  planEnrollments: defineTable({
    userId: v.id("users"),
    planId: v.string(),
    startedAt: v.number(),
  }).index("by_userId_and_planId", ["userId", "planId"]),

  // One row per finished day of a plan.
  planDays: defineTable({
    userId: v.id("users"),
    planId: v.string(),
    day: v.number(),
    doneAt: v.number(),
  }).index("by_userId_and_planId_and_day", ["userId", "planId", "day"]),

  // "Word for Today" and "Worship" videos collected from the approved
  // YouTube channels in videos.ts by a cron (crons.ts).
  videos: defineTable({
    kind,
    channelId: v.string(),
    youtubeId: v.string(),
    title: v.string(),
    by: v.string(),
    publishedAt: v.number(),
  })
    .index("by_kind_and_publishedAt", ["kind", "publishedAt"])
    .index("by_youtubeId", ["youtubeId"]),

  // How the last refresh went for each channel (videos.ts).
  videoStatus: defineTable({
    channelId: v.string(),
    kind,
    by: v.string(),
    source: v.string(),
    found: v.number(),
    error: v.string(),
    at: v.number(),
  }),

  // Which video each calendar day shows, so everyone sees the same one.
  videoPicks: defineTable({
    kind,
    date: v.string(), // "YYYY-MM-DD" (UTC)
    youtubeId: v.string(),
    channelId: v.string(),
  }).index("by_kind_and_date", ["kind", "date"]),
});
