import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

// Elyon Plus: a one-time $1.99 upgrade that unlocks Ask Me, verse
// breakdowns, notes, study plans and the daily videos. Reading the books,
// the topics and the verse for today stay free.
//
// Payment happens in Stripe Checkout (stripe.ts). A purchase is recorded
// here only after Stripe confirms it was paid (webhook or session check),
// and every paid feature checks this table on the server.

export const PRICE_CENTS = 199;

export async function hasPlusFor(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<boolean> {
  const row = await ctx.db
    .query("purchases")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return row !== null;
}

/** Throws unless the signed-in reader has Elyon Plus. */
export async function requirePlus(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  if (!(await hasPlusFor(ctx, userId))) throw new Error("This is part of Elyon Plus.");
}

/** Whether the signed-in reader has Elyon Plus (false when signed out). */
export const hasPlus = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    return userId ? await hasPlusFor(ctx, userId) : false;
  },
});

/** The signed-in reader's id and email, for starting a checkout. */
export const checkoutUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.null(), v.object({ email: v.string(), hasPlus: v.boolean() })),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get("users", userId);
    if (!user) return null;
    return { email: user.email ?? "", hasPlus: await hasPlusFor(ctx, userId) };
  },
});

/** Records a paid Checkout session. Safe to call twice for the same session. */
export const grant = internalMutation({
  args: { userId: v.id("users"), sessionId: v.string(), amount: v.number(), currency: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("purchases")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (existing) return null;
    if (!(await ctx.db.get("users", args.userId))) return null; // account deleted meanwhile
    await ctx.db.insert("purchases", { ...args, product: "plus", paidAt: Date.now() });
    return null;
  },
});
