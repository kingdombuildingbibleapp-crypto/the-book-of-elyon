import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// New "Word for Today" and "Worship" videos and each day's pick (videos.ts).
crons.interval("daily videos", { hours: 3 }, internal.videos.refresh, {});

export default crons;
