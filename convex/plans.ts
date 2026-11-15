import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireUserId } from "./lib/auth";
import { PLAN_DAYS } from "./planCatalog";
import { requirePlus } from "./billing";

function checkPlan(planId: string): number {
  const days = PLAN_DAYS[planId];
  if (!days) throw new Error("Unknown study plan.");
  return days;
}

const progressValidator = v.object({ planId: v.string(), startedAt: v.number(), done: v.array(v.number()) });

/** The plans the reader has started, with the days they've finished. */
export const mine = query({
  args: {},
  returns: v.array(progressValidator),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const enrollments = await ctx.db
      .query("planEnrollments")
      .withIndex("by_userId_and_planId", (q) => q.eq("userId", userId))
      .take(50);
    const out = [];
    for (const e of enrollments) {
      const days = await ctx.db
        .query("planDays")
        .withIndex("by_userId_and_planId_and_day", (q) => q.eq("userId", userId).eq("planId", e.planId))
        .take(400);
      out.push({ planId: e.planId, startedAt: e.startedAt, done: days.map((d) => d.day) });
    }
    return out;
  },
});

export const start = mutation({
  args: { planId: v.string() },
  returns: v.null(),
  handler: async (ctx, { planId }) => {
    const userId = await requireUserId(ctx);
    checkPlan(planId);
    await requirePlus(ctx, userId);
    const existing = await ctx.db
      .query("planEnrollments")
      .withIndex("by_userId_and_planId", (q) => q.eq("userId", userId).eq("planId", planId))
      .unique();
    if (!existing) await ctx.db.insert("planEnrollments", { userId, planId, startedAt: Date.now() });
    return null;
  },
});

/** Marks a day finished or not finished. Starts the plan if needed. */
export const setDay = mutation({
  args: { planId: v.string(), day: v.number(), done: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { planId, day, done }) => {
    const userId = await requireUserId(ctx);
    const total = checkPlan(planId);
    await requirePlus(ctx, userId);
    if (!Number.isInteger(day) || day < 1 || day > total) throw new Error("Unknown day.");
    const enrolled = await ctx.db
      .query("planEnrollments")
      .withIndex("by_userId_and_planId", (q) => q.eq("userId", userId).eq("planId", planId))
      .unique();
    if (!enrolled) await ctx.db.insert("planEnrollments", { userId, planId, startedAt: Date.now() });
    const existing = await ctx.db
      .query("planDays")
      .withIndex("by_userId_and_planId_and_day", (q) => q.eq("userId", userId).eq("planId", planId).eq("day", day))
      .unique();
    if (done && !existing) await ctx.db.insert("planDays", { userId, planId, day, doneAt: Date.now() });
    if (!done && existing) await ctx.db.delete("planDays", existing._id);
    return null;
  },
});

/** Leaves a plan and clears its progress. */
export const leave = mutation({
  args: { planId: v.string() },
  returns: v.null(),
  handler: async (ctx, { planId }) => {
    const userId = await requireUserId(ctx);
    for await (const d of ctx.db
      .query("planDays")
      .withIndex("by_userId_and_planId_and_day", (q) => q.eq("userId", userId).eq("planId", planId))) {
      await ctx.db.delete("planDays", d._id);
    }
    const e = await ctx.db
      .query("planEnrollments")
      .withIndex("by_userId_and_planId", (q) => q.eq("userId", userId).eq("planId", planId))
      .unique();
    if (e) await ctx.db.delete("planEnrollments", e._id);
    return null;
  },
});
