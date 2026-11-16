import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { hasPlusFor } from "./billing";
import { isOwnerUser } from "./lib/owner";

// The owner's page: free Elyon Plus links to share, and Plus given directly
// to someone's account. Who the owners are: lib/owner.ts.

async function ownerCheck(ctx: QueryCtx | MutationCtx): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  return userId ? await isOwnerUser(ctx, userId) : false;
}

async function requireOwner(ctx: QueryCtx | MutationCtx) {
  if (!(await ownerCheck(ctx))) throw new Error("Only the site owner can do this.");
}

/** Whether the signed-in reader is an owner. */
export const isOwner = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => await ownerCheck(ctx),
});

const giftValidator = v.object({
  code: v.string(),
  label: v.string(),
  maxUses: v.union(v.number(), v.null()),
  uses: v.number(),
  active: v.boolean(),
  createdAt: v.number(),
});

/** All free links, newest first, and how many readers have Plus. */
export const overview = query({
  args: {},
  returns: v.object({ gifts: v.array(giftValidator), plusMembers: v.number(), paid: v.number() }),
  handler: async (ctx) => {
    await requireOwner(ctx);
    const gifts = await ctx.db.query("giftLinks").order("desc").take(200);
    const purchases = await ctx.db.query("purchases").take(5000);
    return {
      gifts: gifts.map(({ code, label, maxUses, uses, active, createdAt }) => ({ code, label, maxUses, uses, active, createdAt })),
      plusMembers: purchases.length,
      paid: purchases.filter((p) => p.sessionId.startsWith("cs_")).length,
    };
  },
});

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes (0/o, 1/l/i)
function newCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Creates a free Elyon Plus link. maxUses null = unlimited. */
export const createGift = mutation({
  args: { label: v.string(), maxUses: v.union(v.number(), v.null()) },
  returns: v.string(),
  handler: async (ctx, { label, maxUses }) => {
    await requireOwner(ctx);
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100000)) throw new Error("Enter a number of people from 1 to 100000, or leave it empty for unlimited.");
    const code = newCode();
    await ctx.db.insert("giftLinks", { code, label: label.trim().slice(0, 80) || "Free Elyon Plus", maxUses, uses: 0, active: true, createdAt: Date.now() });
    return code;
  },
});

export const setGiftActive = mutation({
  args: { code: v.string(), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { code, active }) => {
    await requireOwner(ctx);
    const gift = await ctx.db.query("giftLinks").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (gift) await ctx.db.patch("giftLinks", gift._id, { active });
    return null;
  },
});

/** Gives Elyon Plus to an existing account by email. */
export const grantByEmail = mutation({
  args: { email: v.string() },
  returns: v.string(),
  handler: async (ctx, { email }) => {
    await requireOwner(ctx);
    const e = email.trim().toLowerCase();
    const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", e)).first();
    if (!user) return "No account uses that email yet. Send them a free link instead, or ask them to create an account first.";
    if (await hasPlusFor(ctx, user._id)) return `${e} already has Elyon Plus.`;
    await ctx.db.insert("purchases", { userId: user._id, product: "plus", sessionId: `owner:${user._id}`, amount: 0, currency: "usd", paidAt: Date.now() });
    return `Elyon Plus given to ${e}.`;
  },
});

/** What a free link offers, for the page the link opens. */
export const giftInfo = query({
  args: { code: v.string() },
  returns: v.union(v.null(), v.object({ label: v.string(), open: v.boolean() })),
  handler: async (ctx, { code }) => {
    const gift = await ctx.db.query("giftLinks").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (!gift) return null;
    return { label: gift.label, open: gift.active && (gift.maxUses === null || gift.uses < gift.maxUses) };
  },
});

/** Redeems a free link for the signed-in reader. */
export const redeemGift = mutation({
  args: { code: v.string() },
  returns: v.union(v.literal("unlocked"), v.literal("already"), v.literal("closed"), v.literal("unknown")),
  handler: async (ctx, { code }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in first.");
    const gift = await ctx.db.query("giftLinks").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (!gift) return "unknown";
    if (await hasPlusFor(ctx, userId)) return "already";
    if (!gift.active || (gift.maxUses !== null && gift.uses >= gift.maxUses)) return "closed";
    await ctx.db.insert("purchases", { userId, product: "plus", sessionId: `gift:${code}:${userId}`, amount: 0, currency: "usd", paidAt: Date.now() });
    await ctx.db.patch("giftLinks", gift._id, { uses: gift.uses + 1 });
    return "unlocked";
  },
});
