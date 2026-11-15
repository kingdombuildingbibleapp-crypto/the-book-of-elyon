import type { CapacitorConfig } from "@capacitor/cli";

// The Book of Elyon for Android and iOS.
//
// Like the Kingdom Building Study Bible, the app is a native shell around the
// live site: accounts, notes, plans, AI and daily videos all need a
// connection anyway, and pointing at bookofelyon.org means every website
// update reaches the apps at once with no store resubmission. Only native
// changes (name, icon, splash screen, permissions) need a new app build.
const config: CapacitorConfig = {
  appId: "org.bookofelyon.app",
  appName: "Book of Elyon",
  // Shown only if the live site cannot load (no connection).
  webDir: "app-shell",
  server: {
    url: "https://bookofelyon.org",
    cleartext: false,
  },
  backgroundColor: "#f7f3ec",
  android: { backgroundColor: "#f7f3ec" },
  ios: { backgroundColor: "#f7f3ec", contentInset: "never" },
};

export default config;
