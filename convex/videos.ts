import { v } from "convex/values";
import { internalAction, internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";

// "Word for Today" and "Worship" on the Today page: a different video every
// day, taken from the newest uploads of the approved YouTube channels below.
// A cron (crons.ts) reads each channel's public feed every few hours and
// keeps the uploads that match. Each calendar day then gets its own pick:
// from the channel shown longest ago, its newest video not shown yet, so the
// channels take turns and no video repeats until all have been shown.
//
// To add a channel: its id starts with "UC" (on the channel page: Share
// channel -> Copy channel ID). Add one line with `word(...)` or `worship(...)`.

type Kind = "word" | "worship";
type Channel = { kind: Kind; channelId: string; by: string; keep: RegExp; skip: RegExp };
type Options = { keep?: RegExp; skip?: RegExp };

// Never shown: not a message or song (trailers, podcasts, ads, shorts...).
const NEVER =
  /trailer|teaser|behind the|tutorial|\btour\b|announcement|podcast|#shorts|giveaway|merch|donate|fundrais|live ?stream starting|coming soon/i;
// Also not a song, for the worship list.
const NOT_A_SONG = /sermon|teaching|interview|testimony|devotional|bible study|q ?& ?a|\bmix\b|full concert|episode|\bep\.? ?\d/i;

function join(a: RegExp, b?: RegExp): RegExp {
  return b ? new RegExp(`${a.source}|${b.source}`, "i") : a;
}
function word(channelId: string, by: string, o: Options = {}): Channel {
  return { kind: "word", channelId, by, keep: o.keep ?? /./, skip: join(NEVER, o.skip) };
}
function worship(channelId: string, by: string, o: Options = {}): Channel {
  return { kind: "worship", channelId, by, keep: o.keep ?? /./, skip: join(join(NEVER, NOT_A_SONG), o.skip) };
}

// Approved channels. Nothing shows until at least one is listed for a kind.
export const CHANNELS: Channel[] = [
  // ---- Word for Today: Hebrew and Messianic teachers
  // ---- Worship: songs sung in Hebrew
];

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

/** The title the card shows: the upload title without the channel name, hashtags and labels. */
export function cleanTitle(title: string, by: string): string {
  const name = by.toLowerCase();
  const pieces = title
    .replace(/#\S+/g, "")
    .split(/\s+[|│–—-]\s+|\s*[|│]\s*/)
    .map((s) => s.replace(/[([](?:official[^)\]]*|live|lyrics?|feat[^)\]]*|ft\.?[^)\]]*|4k|hd)[)\]]/gi, "").replace(/\s+/g, " ").trim())
    .filter((s) => s && s.toLowerCase() !== name && !/^(official( music)? video|live|lyrics?|4k|hd)$/i.test(s));
  return (pieces[0] ?? title).trim().slice(0, 120);
}

/** Pulls the uploads out of a channel's YouTube feed. */
export function parseFeed(xml: string, ch: Channel) {
  const out: Array<{ kind: Kind; channelId: string; youtubeId: string; title: string; by: string; publishedAt: number }> = [];
  for (const entry of xml.split("<entry>").slice(1)) {
    const id = /<yt:videoId>([^<]+)</.exec(entry)?.[1];
    const raw = /<media:title>([^<]*)</.exec(entry)?.[1] ?? /<title>([^<]*)</.exec(entry)?.[1];
    const published = Date.parse(/<published>([^<]+)</.exec(entry)?.[1] ?? "");
    if (!id || !raw || Number.isNaN(published)) continue;
    const title = decode(raw);
    if (!ch.keep.test(title) || ch.skip.test(title)) continue;
    const clean = cleanTitle(title, ch.by);
    if (!clean) continue;
    out.push({ kind: ch.kind, channelId: ch.channelId, youtubeId: id, title: clean, by: ch.by, publishedAt: published });
  }
  return out;
}

const videoValidator = v.object({
  kind: v.union(v.literal("word"), v.literal("worship")),
  channelId: v.string(),
  youtubeId: v.string(),
  title: v.string(),
  by: v.string(),
  publishedAt: v.number(),
});

export const refresh = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const videos: Array<typeof videoValidator.type> = [];
    for (const ch of CHANNELS) {
      // The "UULF" playlist is the channel's regular uploads, without Shorts.
      const url = `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${ch.channelId.slice(2)}`;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.warn(`feed ${ch.channelId}: HTTP ${res.status}`);
          continue;
        }
        videos.push(...parseFeed(await res.text(), ch));
      } catch (e) {
        console.warn(`feed ${ch.channelId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await ctx.runMutation(internal.videos.save, { videos, now: Date.now() });
    return null;
  },
});

function utcDate(now: number, offsetDays: number): string {
  return new Date(now + offsetDays * 86400000).toISOString().slice(0, 10);
}

async function pickFor(ctx: MutationCtx, kind: Kind, date: string) {
  const existing = await ctx.db
    .query("videoPicks")
    .withIndex("by_kind_and_date", (q) => q.eq("kind", kind).eq("date", date))
    .unique();
  if (existing) return;
  const approved = new Set(CHANNELS.filter((c) => c.kind === kind).map((c) => c.channelId));
  const pool = (
    await ctx.db
      .query("videos")
      .withIndex("by_kind_and_publishedAt", (q) => q.eq("kind", kind))
      .order("desc")
      .take(2000)
  ).filter((video) => approved.has(video.channelId));
  if (pool.length === 0) return;
  const picks = await ctx.db
    .query("videoPicks")
    .withIndex("by_kind_and_date", (q) => q.eq("kind", kind))
    .order("desc")
    .take(4000);
  const videoShown = new Map<string, string>();
  const channelShown = new Map<string, string>();
  for (const p of picks) {
    if ((videoShown.get(p.youtubeId) ?? "") < p.date) videoShown.set(p.youtubeId, p.date);
    if ((channelShown.get(p.channelId) ?? "") < p.date) channelShown.set(p.channelId, p.date);
  }
  // The channel shown longest ago that still has an unseen video: its newest one.
  let choice: (typeof pool)[number] | undefined;
  for (const video of pool) {
    if (videoShown.has(video.youtubeId)) continue;
    if (!choice || (channelShown.get(video.channelId) ?? "") < (channelShown.get(choice.channelId) ?? "")) choice = video;
  }
  // Everything has been shown: the video shown longest ago.
  if (!choice) {
    for (const video of pool) {
      if (!choice || videoShown.get(video.youtubeId)! < videoShown.get(choice.youtubeId)!) choice = video;
    }
  }
  if (choice) await ctx.db.insert("videoPicks", { kind, date, youtubeId: choice.youtubeId, channelId: choice.channelId });
}

export const save = internalMutation({
  args: { videos: v.array(videoValidator), now: v.number() },
  returns: v.null(),
  handler: async (ctx, { videos, now }) => {
    for (const video of videos) {
      const same = await ctx.db
        .query("videos")
        .withIndex("by_youtubeId", (q) => q.eq("youtubeId", video.youtubeId))
        .take(5);
      const match = same.find((s) => s.kind === video.kind);
      if (match) await ctx.db.replace("videos", match._id, video);
      else await ctx.db.insert("videos", video);
    }
    // Every date it is somewhere in the world right now, today first.
    for (const kind of ["word", "worship"] as const) {
      for (const offset of [0, 1, -1]) await pickFor(ctx, kind, utcDate(now, offset));
    }
    return null;
  },
});

const dayVideo = v.union(v.null(), v.object({ youtubeId: v.string(), title: v.string(), by: v.string() }));

/** A day's two videos; null where there is none yet. */
export const forDay = query({
  args: { date: v.string() },
  returns: v.object({ word: dayVideo, worship: dayVideo }),
  handler: async (ctx, { date }) => {
    const one = async (kind: Kind) => {
      const pick = await ctx.db
        .query("videoPicks")
        .withIndex("by_kind_and_date", (q) => q.eq("kind", kind).eq("date", date))
        .unique();
      if (!pick) return null;
      const rows = await ctx.db
        .query("videos")
        .withIndex("by_youtubeId", (q) => q.eq("youtubeId", pick.youtubeId))
        .take(5);
      const video = rows.find((r) => r.kind === kind);
      return video ? { youtubeId: video.youtubeId, title: video.title, by: video.by } : null;
    };
    return { word: await one("word"), worship: await one("worship") };
  },
});
