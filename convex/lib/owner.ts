import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// The site owner(s). Owners can use everything without paying and see the
// Owner page. Built in: Arron Pinkney. More can be added in OWNER_EMAILS on
// the Convex deployment (comma-separated).
const BUILT_IN_OWNERS = ["arronpinkneysr@gmail.com"];

export function ownerEmails(): string[] {
  const extra = (process.env.OWNER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return [...BUILT_IN_OWNERS, ...extra];
}

export async function isOwnerUser(ctx: QueryCtx | MutationCtx, userId: Id<"users">): Promise<boolean> {
  const user = await ctx.db.get("users", userId);
  return !!user?.email && ownerEmails().includes(user.email.trim().toLowerCase());
}
