import { test } from "vitest";
import { readFileSync } from "node:fs";
import { CHANNELS, parseFeed } from "./videos";

// Preview only: runs the approved channels' filters over real titles saved
// from their YouTube pages. Skipped unless ELYON_TITLES points at that file.
const file = process.env.ELYON_TITLES;
test.skipIf(!file)("channel filter preview", () => {
  const titles: Record<string, string[]> = JSON.parse(readFileSync(file!, "utf8"));
  for (const ch of CHANNELS) {
    const xml = (titles[ch.channelId] ?? [])
      .map((t, i) => `<entry><yt:videoId>v${i}</yt:videoId><title>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</title><published>2026-01-01T00:00:00Z</published></entry>`)
      .join("");
    const kept = parseFeed("<feed>" + xml, ch);
    console.log(`\n== ${ch.kind} · ${ch.by}: ${kept.length} of ${(titles[ch.channelId] ?? []).length} kept`);
    for (const v of kept) console.log("   ", v.title);
  }
});
