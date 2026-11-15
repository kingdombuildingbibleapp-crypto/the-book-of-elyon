import { v } from "convex/values";
import { internalAction, internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { hasPlusFor } from "./billing";

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
// Each `keep`/`skip` was tuned against the channel's real uploads (Nov 2026).
const POLITICS = /trump|biden|huckabee|election|vote|politic|congress|iran|hamas|hezbollah|gaza|war\b|operation|antichrist|battle for|the west|news|update/i;
export const CHANNELS: Channel[] = [
  // ---- Word for Today: Hebrew and Messianic teachers
  word("UCQDc5idYQE2T6IYKT3bUN7A", "ONE FOR ISRAEL", {
    skip: /pod for israel|one for israel tv|story|aliyah|worship|sing to|song|ashira|october 7|!$/i,
  }),
  word("UCm8v2K8fLkEoq4QEOEH0m7Q", "Rabbi Kirt Schneider", {
    skip: /interview|kidnapped|billboard|part \d/i,
  }),
  word("UCjsoQpzk-XQOt4YM6nzq_-Q", "Jonathan Cahn", {
    keep: /sermon|full message/i,
    skip: join(POLITICS, /tour|cruise|special|halloween|because you asked|america|islam|nazi|new york|national judgment|harbinger/i),
  }),
  word("UCa3C7WpFobavsDJdkKUtodw", "Amir Tsarfati", {
    keep: /bible|devotional|testament|scripture|gospel|jesus|yeshua|irrevocable|truth be told/i,
    skip: join(POLITICS, /prophetic timeline|time is running out|too late/i),
  }),
  // ---- Worship: songs sung in Hebrew
  worship("UCUnGMSK1qwdmUwOw7UypW-A", "Shilo Ben Hod", { skip: /what is solu/i }),
  worship("UCo_DEZcd1mUgIEuE_XLms7Q", "Joshua Aaron", {
    skip: /\bstop\b|cities|introduction|shalom|gather the nations|full concert|pre ?order|masada|upper room|miss you|^[“"]/i,
  }),
  worship("UC6Zjr_rR7K9rTOcaZ6ywEtg", "Emanuel Roro", {
    skip: /reaction|sunday service|interview|instrumental|pray together|bomb shelter|streets of jaffa|kanye|guitar|strings|^miqedem$|shilo ben hod/i,
  }),
  worship("UCQDc5idYQE2T6IYKT3bUN7A", "ONE FOR ISRAEL", {
    keep: /sing|song|worship|hallel|ashira|praise|psalm/i,
    skip: /what happens when|pod for israel|tv\b|together\?/i,
  }),
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

/** The title the card shows: the upload title without the channel name, handles, hashtags and labels. */
export function cleanTitle(title: string, by: string, kind: Kind = "word"): string {
  const name = by.toLowerCase();
  const junk = /^(official( music)? video|music video|live|lyrics?|4k|hd|hebrew worship|best worship songs.*|sermon|full message|subs)$/i;
  const pieces = title
    .replace(/@SOLU ?Israel/gi, "").replace(/#\S+|@\S+/g, "")
    .replace(/\s+LIVE (?:at|from) [^|/]*/gi, "")
    .split(kind === "worship" ? /\s+[|│–—-]\s+|\s*[|│/]\s*/ : /\s+[|│–—]\s+|\s*[|│]\s*/)
    .map((s) =>
      s
        .replace(/[([](?:official[^)\]]*|live[^)\]]*|lyrics?|feat[^)\]]*|ft\.?[^)\]]*|4k|hd|subs|music video[^)\]]*|\d{4}|worship session|hebrew worship|jerusalem worship)[)\]]/gi, "")
        .replace(/\s+/g, " ")
        .replace(/^[\s\-–—:&,]+|[\s\-–—:&,]+$/g, "")
        .trim(),
    )
    .filter((s) => s && !s.toLowerCase().includes(name) && !/sermon$|full message$/i.test(s) && !junk.test(s));
  if (!pieces.length) return title.trim().slice(0, 120);
  // Worship: keep the Hebrew title alongside the English one ("Avinu · Our Father").
  const out = kind === "worship" && pieces[1] && pieces[1].length <= 32 ? `${pieces[0]} · ${pieces[1]}` : pieces[0];
  return out.slice(0, 120);
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
    // Artists' channels also carry posts like "Seven more cities to go! 🔥".
    if (ch.kind === "worship" && /\p{Extended_Pictographic}|\p{Regional_Indicator}|!!/u.test(title)) continue;
    const clean = cleanTitle(title, ch.by, ch.kind);
    if (!clean) continue;
    out.push({ kind: ch.kind, channelId: ch.channelId, youtubeId: id, title: clean, by: ch.by, publishedAt: published });
  }
  return out;
}

const AGE_UNITS: Record<string, number> = {
  second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6,
};

/**
 * Fallback when the feed is refused: the uploads listed on the channel's
 * "Videos" page. Dates there are relative ("3 days ago"), so they are
 * approximate, which is enough to order the videos newest first.
 */
export function parseChannelPage(html: string, ch: Channel, now: number) {
  const out: ReturnType<typeof parseFeed> = [];
  const seen = new Set<string>();
  for (const block of html.split('"richItemRenderer":{"content":{"lockupViewModel"').slice(1)) {
    const id = /\/vi\/([\w-]{11})\//.exec(block)?.[1] ?? /"videoId":"([\w-]{11})"/.exec(block)?.[1];
    const rawTitle = /"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/.exec(block)?.[1];
    if (!id || !rawTitle || seen.has(id)) continue;
    seen.add(id);
    let title: string;
    try { title = JSON.parse(`"${rawTitle}"`); } catch { continue; }
    const age = /"accessibilityLabel":"(\d+) (second|minute|hour|day|week|month|year)s? ago"/.exec(block);
    const publishedAt = age ? now - Number(age[1]) * AGE_UNITS[age[2]] : now - out.length * 864e5;
    if (!ch.keep.test(title) || ch.skip.test(title)) continue;
    if (ch.kind === "worship" && /\p{Extended_Pictographic}|\p{Regional_Indicator}|!!/u.test(title)) continue;
    const clean = cleanTitle(title, ch.by, ch.kind);
    if (clean) out.push({ kind: ch.kind, channelId: ch.channelId, youtubeId: id, title: clean, by: ch.by, publishedAt });
  }
  return out;
}

const statusValidator = v.object({
  channelId: v.string(),
  kind: v.union(v.literal("word"), v.literal("worship")),
  by: v.string(),
  source: v.string(), // "feed" | "page" | "none"
  found: v.number(),
  error: v.string(),
});

const videoValidator = v.object({
  kind: v.union(v.literal("word"), v.literal("worship")),
  channelId: v.string(),
  youtubeId: v.string(),
  title: v.string(),
  by: v.string(),
  publishedAt: v.number(),
});

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Cookie: "CONSENT=YES+1; SOCS=CAI",
};

export const refresh = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const videos: Array<typeof videoValidator.type> = [];
    const status: Array<typeof statusValidator.type> = [];
    const now = Date.now();
    for (const ch of CHANNELS) {
      const st = { channelId: ch.channelId, kind: ch.kind, by: ch.by, source: "none", found: 0, error: "" };
      // 1. The channel's public feed. The "UULF" playlist is its regular uploads, without Shorts.
      try {
        const res = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${ch.channelId.slice(2)}`, { headers: HEADERS });
        if (res.ok) {
          const xml = await res.text();
          if (xml.includes("<entry>")) {
            const got = parseFeed(xml, ch);
            videos.push(...got);
            Object.assign(st, { source: "feed", found: got.length });
          }
        } else st.error = `feed HTTP ${res.status}`;
      } catch (e) {
        st.error = `feed ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
      }
      // 2. If the feed was refused or empty, the channel's Videos page.
      if (st.source === "none") {
        try {
          const res = await fetch(`https://www.youtube.com/channel/${ch.channelId}/videos`, { headers: HEADERS });
          if (res.ok) {
            const got = parseChannelPage(await res.text(), ch, now);
            videos.push(...got);
            Object.assign(st, { source: "page", found: got.length });
          } else st.error += `; page HTTP ${res.status}`;
        } catch (e) {
          st.error += `; page ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
        }
      }
      if (st.found === 0) console.warn(`videos ${ch.by} (${ch.kind}): ${st.error || "no matching uploads"}`);
      status.push(st);
    }
    await ctx.runMutation(internal.videos.save, { videos, now, status });
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
  args: { videos: v.array(videoValidator), now: v.number(), status: v.optional(v.array(statusValidator)) },
  returns: v.null(),
  handler: async (ctx, { videos, now, status }) => {
    if (status) {
      for (const old of await ctx.db.query("videoStatus").take(100)) await ctx.db.delete("videoStatus", old._id);
      for (const st of status) await ctx.db.insert("videoStatus", { ...st, at: now });
    }
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

/** A day's two videos for Elyon Plus readers; null where there is none yet. */
export const forDay = query({
  args: { date: v.string() },
  returns: v.object({ word: dayVideo, worship: dayVideo, locked: v.boolean() }),
  handler: async (ctx, { date }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(await hasPlusFor(ctx, userId))) return { word: null, worship: null, locked: true };
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
    return { word: await one("word"), worship: await one("worship"), locked: false };
  },
});

/** How the last refresh went for each channel (for checking the setup; no personal data). */
export const status = query({
  args: {},
  returns: v.array(statusValidator.extend({ at: v.number() })),
  handler: async (ctx) =>
    (await ctx.db.query("videoStatus").take(100)).map(({ channelId, kind, by, source, found, error, at }) => ({ channelId, kind, by, source, found, error, at })),
});
