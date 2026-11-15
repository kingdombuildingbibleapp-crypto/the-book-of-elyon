/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { CHANNELS, cleanTitle, parseFeed } from "./videos";

const modules = import.meta.glob("./**/*.ts");

async function reader(t: ReturnType<typeof convexTest>, email = "ruth@example.com") {
  const userId = await t.run((ctx) => ctx.db.insert("users", { email, name: "Ruth" }));
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
  const today = await t.query(api.videos.forDay, { date: "2026-03-10" });
  expect(today.word).toBeNull();
  expect(today.worship?.youtubeId).toBeDefined();
  // Running again keeps the same pick and fills nearby days with other videos.
  await t.mutation(internal.videos.save, { videos, now });
  const again = await t.query(api.videos.forDay, { date: "2026-03-10" });
  expect(again.worship?.youtubeId).toBe(today.worship?.youtubeId);
  const ids = new Set(
    await Promise.all(["2026-03-09", "2026-03-10", "2026-03-11"].map(async (d) => (await t.query(api.videos.forDay, { date: d })).worship?.youtubeId)),
  );
  expect(ids.size).toBe(3);
});
