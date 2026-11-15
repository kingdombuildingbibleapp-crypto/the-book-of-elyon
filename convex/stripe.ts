"use node";
// Stripe calls for Elyon Plus (see billing.ts). Runs in Convex's Node runtime.
//
// Needs on the Convex deployment:
//   STRIPE_SECRET_KEY      sk_live_... (or sk_test_... while testing)
//   STRIPE_WEBHOOK_SECRET  whsec_... from the Stripe webhook pointing at
//                          https://<deployment>.convex.site/stripe/webhook
import Stripe from "stripe";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { PRICE_CENTS } from "./billing";
import type { Id } from "./_generated/dataModel";

const SITE = "https://bookofelyon.org";

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Payments are not set up yet.");
  return new Stripe(key);
}

/** Starts a Stripe Checkout for Elyon Plus and returns its URL. */
export const checkout = action({
  args: {},
  returns: v.string(),
  handler: async (ctx): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Please sign in first.");
    const user = await ctx.runQuery(internal.billing.checkoutUser, { userId });
    if (!user) throw new Error("Please sign in first.");
    if (user.hasPlus) throw new Error("You already have Elyon Plus.");
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: PRICE_CENTS,
            product_data: {
              name: "Elyon Plus",
              description: "Lifetime access to Ask Me, verse breakdowns, notes, study plans and daily videos.",
            },
          },
        },
      ],
      customer_email: user.email || undefined,
      client_reference_id: userId,
      metadata: { userId, product: "plus" },
      success_url: `${SITE}/#plus/thanks/{CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/#plus`,
    });
    if (!session.url) throw new Error("Could not start the payment. Please try again.");
    return session.url;
  },
});

async function recordIfPaid(ctx: ActionCtx, session: Stripe.Checkout.Session): Promise<boolean> {
  const userId = session.metadata?.userId ?? session.client_reference_id;
  if (session.payment_status !== "paid" || session.metadata?.product !== "plus" || !userId) return false;
  await ctx.runMutation(internal.billing.grant, {
    userId: userId as Id<"users">,
    sessionId: session.id,
    amount: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
  });
  return true;
}

/** After Stripe sends the reader back: checks the session and records it if paid. */
export const confirm = action({
  args: { sessionId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { sessionId }): Promise<boolean> => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return false;
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    // Only the reader who paid can claim their own session.
    if ((session.metadata?.userId ?? session.client_reference_id) !== userId) return false;
    return await recordIfPaid(ctx, session);
  },
});

/** Stripe webhook (from http.ts): verifies the signature, then records paid checkouts. */
export const fulfill = internalAction({
  args: { payload: v.string(), signature: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { payload, signature }): Promise<boolean> => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    const event = await stripe().webhooks.constructEventAsync(payload, signature, secret);
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await recordIfPaid(ctx, event.data.object);
    }
    return true;
  },
});
