import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";

/** The signed-in reader's name and email, or null when signed out. */
export const me = query({
  args: {},
  returns: v.union(v.null(), v.object({ name: v.string(), email: v.string() })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get("users", userId);
    if (!user) return null;
    return { name: user.name ?? "", email: user.email ?? "" };
  },
});

/** Deletes the account and everything saved with it. */
export const deleteAccount = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in first.");

    for await (const n of ctx.db.query("notes").withIndex("by_userId_and_updatedAt", (q) => q.eq("userId", userId))) {
      await ctx.db.delete("notes", n._id);
    }
    for await (const e of ctx.db.query("planEnrollments").withIndex("by_userId_and_planId", (q) => q.eq("userId", userId))) {
      await ctx.db.delete("planEnrollments", e._id);
    }
    for await (const d of ctx.db.query("planDays").withIndex("by_userId_and_planId_and_day", (q) => q.eq("userId", userId))) {
      await ctx.db.delete("planDays", d._id);
    }
    // Sign-in records, so the email can be used again later.
    for await (const s of ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId))) {
      for await (const t of ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", s._id))) {
        await ctx.db.delete("authRefreshTokens", t._id);
      }
      await ctx.db.delete("authSessions", s._id);
    }
    for await (const a of ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", userId))) {
      await ctx.db.delete("authAccounts", a._id);
    }
    await ctx.db.delete("users", userId);
    return null;
  },
});
