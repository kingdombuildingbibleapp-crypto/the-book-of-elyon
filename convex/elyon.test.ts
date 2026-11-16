/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { CHANNELS, cleanTitle, parseFeed } from "./videos";

const modules = import.meta.glob("./**/*.ts");

async function reader(t: ReturnType<typeof convexTest>, email = "ruth@example.com", plus = true) {
  const userId = await t.run((ctx) => ctx.db.insert("users", { email, name: "Ruth" }));
  if (plus) await t.mutation(internal.billing.grant, { userId, sessionId: `cs_test_${email}`, amount: 199, currency: "usd" });
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 1e9 }),
  );
  return { userId, as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

test("signed-out readers see nothing and cannot save", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.users.me, {})).toBeNull();
  expect(await t.query(api.notes.mine, {})).toEqual([]);
  expect(await t.query(api.plans.mine, {})).toEqual([]);
  await expect(t.mutation(api.notes.save, { bookId: "GEN", chapter: 1, verse: 1, text: "x" })).rejects.toThrow(/sign in/);
});

test("notes: save, update, list newest first, delete with empty text", async () => {
  const t = convexTest(schema, modules);
  const { as } = await reader(t);
  expect(await as.query(api.users.me, {})).toEqual({ name: "Ruth", email: "ruth@example.com" });
  await as.mutation(api.notes.save, { bookId: "GEN", chapter: 1, verse: 1, text: "  In the beginning  " });
  await as.mutation(api.notes.save, { bookId: "JOH", chapter: 3, verse: 16, text: "Love" });
  await as.mutation(api.notes.save, { bookId: "GEN", chapter: 1, verse: 1, text: "Edited" });
  const notes = await as.query(api.notes.mine, {});
  expect(notes.map((n) => [n.bookId, n.text])).toEqual([["GEN", "Edited"], ["JOH", "Love"]]);
  await as.mutation(api.notes.save, { bookId: "GEN", chapter: 1, verse: 1, text: "   " });
  expect((await as.query(api.notes.mine, {})).length).toBe(1);
  await expect(as.mutation(api.notes.save, { bookId: "GEN", chapter: 0, verse: 1, text: "x" })).rejects.toThrow();
});

test("notes are private to each reader", async () => {
  const t = convexTest(schema, modules);
  const a = await reader(t, "a@example.com");
  const b = await reader(t, "b@example.com");
  await a.as.mutation(api.notes.save, { bookId: "PSA", chapter: 23, verse: 1, text: "mine" });
  expect(await b.as.query(api.notes.mine, {})).toEqual([]);
});

test("plans: start, tick days, leave", async () => {
  const t = convexTest(schema, modules);
  const { as } = await reader(t);
  await as.mutation(api.plans.setDay, { planId: "gospels-30", day: 1, done: true });
  await as.mutation(api.plans.setDay, { planId: "gospels-30", day: 2, done: true });
  await as.mutation(api.plans.setDay, { planId: "gospels-30", day: 2, done: true }); // idempotent
  await as.mutation(api.plans.setDay, { planId: "gospels-30", day: 1, done: false });
  let mine = await as.query(api.plans.mine, {});
  expect(mine).toHaveLength(1);
  expect(mine[0].done).toEqual([2]);
  await expect(as.mutation(api.plans.setDay, { planId: "gospels-30", day: 31, done: true })).rejects.toThrow();
  await expect(as.mutation(api.plans.start, { planId: "nope" })).rejects.toThrow(/Unknown/);
  await as.mutation(api.plans.leave, { planId: "gospels-30" });
  mine = await as.query(api.plans.mine, {});
  expect(mine).toEqual([]);
});

test("deleting an account removes its data and sign-in records", async () => {
  const t = convexTest(schema, modules);
  const { as, userId } = await reader(t);
  await as.mutation(api.notes.save, { bookId: "GEN", chapter: 1, verse: 1, text: "x" });
  await as.mutation(api.plans.setDay, { planId: "torah-40", day: 3, done: true });
  await as.mutation(api.users.deleteAccount, {});
  const left = await t.run(async (ctx) => ({
    user: await ctx.db.get("users", userId),
    notes: (await ctx.db.query("notes").collect()).length,
    days: (await ctx.db.query("planDays").collect()).length,
    enrollments: (await ctx.db.query("planEnrollments").collect()).length,
    sessions: (await ctx.db.query("authSessions").collect()).length,
  }));
  expect(left).toEqual({ user: null, notes: 0, days: 0, enrollments: 0, sessions: 0 });
});

const feed = `<feed><entry><yt:videoId>aaa</yt:videoId><title>Shalom Aleichem | Joshua Aaron (Official Video) #worship</title><published>2026-01-02T00:00:00+00:00</published></entry>
<entry><yt:videoId>bbb</yt:videoId><title>Tour announcement 2026</title><published>2026-01-03T00:00:00+00:00</published></entry>
<entry><yt:videoId>ccc</yt:videoId><title>Hallelujah &amp; Hosanna</title><published>2026-01-01T00:00:00+00:00</published></entry></feed>`;

test("feeds: titles are cleaned and non-songs skipped", () => {
  expect(cleanTitle("Shalom Aleichem | Joshua Aaron (Official Video) #worship", "Joshua Aaron")).toBe("Shalom Aleichem");
  const ch = { kind: "worship" as const, channelId: "UCx", by: "Joshua Aaron", keep: /./, skip: /tour/i };
  expect(parseFeed(feed, ch).map((v) => [v.youtubeId, v.title])).toEqual([
    ["aaa", "Shalom Aleichem"],
    ["ccc", "Hallelujah & Hosanna"],
  ]);
});

test("daily picks rotate and stay fixed for the day", async () => {
  const t = convexTest(schema, modules);
  // Use an approved channel id if any are configured, else a placeholder the
  // test adds to the list for this run.
  const channelId = CHANNELS.find((c) => c.kind === "worship")?.channelId ?? "UCtest";
  if (!CHANNELS.some((c) => c.channelId === channelId)) {
    CHANNELS.push({ kind: "worship", channelId, by: "Test", keep: /./, skip: /^$/ });
  }
  const now = Date.parse("2026-03-10T12:00:00Z");
  const videos = ["v1", "v2", "v3"].map((id, i) => ({
    kind: "worship" as const, channelId, youtubeId: id, title: id, by: "Test", publishedAt: now - i * 1000,
  }));
  await t.mutation(internal.videos.save, { videos, now });
  expect((await t.query(api.videos.forDay, { date: "2026-03-10" })).locked).toBe(true);
  const { as } = await reader(t); // has Elyon Plus
  const today = await as.query(api.videos.forDay, { date: "2026-03-10" });
  expect(today.word).toBeNull();
  expect(today.worship?.youtubeId).toBeDefined();
  // Running again keeps the same pick and fills nearby days with other videos.
  await t.mutation(internal.videos.save, { videos, now });
  const again = await as.query(api.videos.forDay, { date: "2026-03-10" });
  expect(again.worship?.youtubeId).toBe(today.worship?.youtubeId);
  const ids = new Set(
    await Promise.all(["2026-03-09", "2026-03-10", "2026-03-11"].map(async (d) => (await as.query(api.videos.forDay, { date: d })).worship?.youtubeId)),
  );
  expect(ids.size).toBe(3);
});

test("channel page fallback reads uploads from a saved YouTube page", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const f = process.env.ELYON_PAGE;
  if (!f || !existsSync(f)) return;
  const { parseChannelPage } = await import("./videos");
  const ch = CHANNELS.find((c) => c.by === "Shilo Ben Hod")!;
  const got = parseChannelPage(readFileSync(f, "utf8"), ch, Date.parse("2026-11-15T00:00:00Z"));
  console.log(got.slice(0, 5).map((v) => `${v.youtubeId} ${new Date(v.publishedAt).toISOString().slice(0, 10)} ${v.title}`).join("\n"));
  expect(got.length).toBeGreaterThan(10);
  expect(got[0].youtubeId).toMatch(/^[\w-]{11}$/);
});

test("Elyon Plus: free readers can't write notes or plans; purchase unlocks; grant is idempotent", async () => {
  const t = convexTest(schema, modules);
  const { as, userId } = await reader(t, "free@example.com", false);
  expect(await as.query(api.billing.hasPlus, {})).toBe(false);
  await expect(as.mutation(api.notes.save, { bookId: "GEN", chapter: 1, verse: 1, text: "x" })).rejects.toThrow(/Elyon Plus/);
  await expect(as.mutation(api.plans.start, { planId: "gospels-30" })).rejects.toThrow(/Elyon Plus/);
  await expect(as.mutation(api.plans.setDay, { planId: "gospels-30", day: 1, done: true })).rejects.toThrow(/Elyon Plus/);
  // Deleting a note is still allowed (no-op here).
  await as.mutation(api.notes.save, { bookId: "GEN", chapter: 1, verse: 1, text: "" });
  await t.mutation(internal.billing.grant, { userId, sessionId: "cs_test_1", amount: 199, currency: "usd" });
  await t.mutation(internal.billing.grant, { userId, sessionId: "cs_test_1", amount: 199, currency: "usd" });
  expect(await t.run(async (ctx) => (await ctx.db.query("purchases").collect()).length)).toBe(1);
  expect(await as.query(api.billing.hasPlus, {})).toBe(true);
  await as.mutation(api.notes.save, { bookId: "GEN", chapter: 1, verse: 1, text: "x" });
  await as.mutation(api.users.deleteAccount, {});
  expect(await t.run(async (ctx) => (await ctx.db.query("purchases").collect()).length)).toBe(0);
});

test("signed-out readers see the daily videos as locked", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.videos.forDay, { date: "2026-03-10" })).toEqual({ word: null, worship: null, locked: true });
});

test("owner: free links give Plus, respect limits and on/off; grant by email; others are refused", async () => {
  process.env.OWNER_EMAILS = "Owner@Example.com";
  const t = convexTest(schema, modules);
  const owner = await reader(t, "owner@example.com", false);
  const a = await reader(t, "a@example.com", false);
  const b = await reader(t, "b@example.com", false);
  const c = await reader(t, "c@example.com", false);
  expect(await owner.as.query(api.owner.isOwner, {})).toBe(true);
  expect(await a.as.query(api.owner.isOwner, {})).toBe(false);
  await expect(a.as.mutation(api.owner.createGift, { label: "x", maxUses: null })).rejects.toThrow(/owner/);
  await expect(a.as.query(api.owner.overview, {})).rejects.toThrow(/owner/);

  const code = await owner.as.mutation(api.owner.createGift, { label: "Friends", maxUses: 1 });
  expect(code).toMatch(/^[a-z2-9]{10}$/);
  expect(await t.query(api.owner.giftInfo, { code })).toEqual({ label: "Friends", open: true });
  expect(await a.as.mutation(api.owner.redeemGift, { code })).toBe("unlocked");
  expect(await a.as.query(api.billing.hasPlus, {})).toBe(true);
  expect(await a.as.mutation(api.owner.redeemGift, { code })).toBe("already");
  expect(await b.as.mutation(api.owner.redeemGift, { code })).toBe("closed"); // limit of 1 reached
  expect(await b.as.mutation(api.owner.redeemGift, { code: "nope" })).toBe("unknown");

  const open = await owner.as.mutation(api.owner.createGift, { label: "Everyone", maxUses: null });
  await owner.as.mutation(api.owner.setGiftActive, { code: open, active: false });
  expect(await b.as.mutation(api.owner.redeemGift, { code: open })).toBe("closed");
  await owner.as.mutation(api.owner.setGiftActive, { code: open, active: true });
  expect(await b.as.mutation(api.owner.redeemGift, { code: open })).toBe("unlocked");

  expect(await owner.as.mutation(api.owner.grantByEmail, { email: " C@example.com " })).toMatch(/given/);
  expect(await c.as.query(api.billing.hasPlus, {})).toBe(true);
  expect(await owner.as.mutation(api.owner.grantByEmail, { email: "nobody@example.com" })).toMatch(/No account/);
  const ov = await owner.as.query(api.owner.overview, {});
  expect(ov.plusMembers).toBe(3);
  expect(ov.paid).toBe(0);
  expect(ov.gifts.map((g) => [g.label, g.uses])).toEqual([["Everyone", 1], ["Friends", 1]]);
  delete process.env.OWNER_EMAILS;
});

test("the built-in owner has everything without paying", async () => {
  const t = convexTest(schema, modules);
  const owner = await reader(t, "ArronPinkneySr@gmail.com", false);
  expect(await owner.as.query(api.owner.isOwner, {})).toBe(true);
  expect(await owner.as.query(api.billing.hasPlus, {})).toBe(true);
  await owner.as.mutation(api.notes.save, { bookId: "GEN", chapter: 1, verse: 1, text: "owner note" });
  await owner.as.mutation(api.plans.setDay, { planId: "gospels-30", day: 1, done: true });
  expect((await owner.as.query(api.videos.forDay, { date: "2026-03-10" })).locked).toBe(false);
});
