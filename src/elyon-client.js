// Sign-in and saved data for The Book of Elyon, in the browser.
//
// Talks to the site's Convex backend (convex/). Sign-in uses Convex Auth's
// email and password provider: the sign-in action returns a short-lived token
// and a refresh token, kept in localStorage like Convex Auth's own React
// client does. Bundled by `npm run build:client` into public/js/elyon-client.js.
import { ConvexClient, ConvexHttpClient } from "convex/browser";

const URL_ = (window.ELYON_CONVEX_URL || "").trim();
const enabled = /^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(URL_);
const ns = URL_.replace(/[^a-zA-Z0-9]/g, "");
const JWT = `__convexAuthJWT_${ns}`;
const REFRESH = `__convexAuthRefreshToken_${ns}`;

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

const client = enabled ? new ConvexClient(URL_) : null;
const listeners = new Set();
let token = store.get(JWT);
let signedIn = false;
let refreshing = null;

function notify() { for (const cb of listeners) { try { cb(signedIn); } catch (e) { console.error(e); } } }

function saveTokens(tokens) {
  token = tokens ? tokens.token : null;
  store.set(JWT, token);
  store.set(REFRESH, tokens ? tokens.refreshToken : null);
}

// A fresh client per sign-in call, without the (possibly expired) token.
const anon = () => new ConvexHttpClient(URL_);

async function refresh() {
  const refreshToken = store.get(REFRESH);
  if (!refreshToken) return null;
  refreshing ??= anon()
    .action("auth:signIn", { refreshToken })
    .then((r) => { saveTokens(r && r.tokens ? r.tokens : null); return token; })
    .catch((e) => {
      // Network trouble: keep the tokens and try again later.
      if (/fetch|network/i.test(String(e && e.message))) return null;
      saveTokens(null);
      return null;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

function connect() {
  client.setAuth(
    async ({ forceRefreshToken }) => (forceRefreshToken ? await refresh() : token),
    (isAuthenticated) => { signedIn = isAuthenticated; notify(); },
  );
}
if (client) connect();

// Another tab signed in or out.
addEventListener("storage", (e) => {
  if (client && e.key === JWT) { token = e.newValue; connect(); if (!token) { signedIn = false; notify(); } }
});

function friendly(e, flow) {
  const m = String((e && e.message) || e);
  if (/InvalidSecret|InvalidAccountId|Invalid credentials/i.test(m)) return "That email and password don't match an account.";
  if (/already exists/i.test(m)) return "An account with this email already exists. Try signing in.";
  if (/Invalid password/i.test(m)) return "Please choose a password of at least 8 characters.";
  if (/TooManyFailedAttempts|rate/i.test(m)) return "Too many tries. Please wait a few minutes and try again.";
  if (/fetch|network/i.test(m)) return "Could not connect. Check your internet connection and try again.";
  // The live backend hides error details, so say what usually went wrong.
  return flow === "signUp"
    ? "Could not create the account. If you already have one with this email, try signing in instead."
    : "That email and password don't match an account. Check them and try again.";
}

const Elyon = {
  enabled,
  isSignedIn: () => signedIn,
  onAuth(cb) { listeners.add(cb); cb(signedIn); return () => listeners.delete(cb); },
  async signIn(flow, { email, password, name }) {
    if (!client) throw new Error("Accounts are not available yet.");
    const params = { flow, email: String(email || "").trim().toLowerCase(), password: String(password || "") };
    if (flow === "signUp") params.name = String(name || "").trim();
    let r;
    try { r = await anon().action("auth:signIn", { provider: "password", params }); }
    catch (e) { throw new Error(friendly(e, flow)); }
    if (!r || !r.tokens) throw new Error(friendly(null, flow));
    saveTokens(r.tokens);
    connect();
  },
  async signOut() {
    if (!client) return;
    try { const h = anon(); if (token) h.setAuth(token); await h.action("auth:signOut", {}); } catch {}
    saveTokens(null);
    client.client.clearAuth?.();
    connect();
    signedIn = false;
    notify();
  },
  /** Live query: calls cb with every new result; returns an unsubscribe function. */
  watch(fn, args, cb, onError) {
    if (!client) return () => {};
    return client.onUpdate(fn, args || {}, cb, onError || ((e) => console.error(fn, e)));
  },
  query: (fn, args) => (client ? client.query(fn, args || {}) : Promise.reject(new Error("Not available"))),
  mutation: (fn, args) => (client ? client.mutation(fn, args || {}) : Promise.reject(new Error("Not available"))),
};

window.Elyon = Elyon;
window.dispatchEvent(new Event("elyon-ready"));
