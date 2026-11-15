import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);

// Stripe tells us here when a payment for Elyon Plus completes.
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const signature = req.headers.get("stripe-signature");
    if (!signature) return new Response("Missing signature", { status: 400 });
    try {
      await ctx.runAction(internal.stripe.fulfill, { payload: await req.text(), signature });
      return new Response(null, { status: 200 });
    } catch (e) {
      console.error("stripe webhook", e);
      return new Response("Webhook error", { status: 400 });
    }
  }),
});

export default http;
