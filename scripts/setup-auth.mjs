// One-time sign-in setup for the Convex backend.
//
// Creates the key pair Convex Auth signs sign-in tokens with and saves it,
// with the site's address, on the Convex deployment.
//
//   node scripts/setup-auth.mjs          # the development deployment
//   node scripts/setup-auth.mjs --prod   # the live (production) deployment
//
// Run `npx convex dev` once first, so this folder is linked to your Convex project.
import { generateKeyPair, exportPKCS8, exportJWK } from "jose";
import { spawnSync } from "node:child_process";

const prod = process.argv.includes("--prod");
const siteUrl = prod ? "https://bookofelyon.org" : "http://localhost:8888";

const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, " ");
const jwks = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(keys.publicKey)) }] });

for (const [name, value] of [["JWT_PRIVATE_KEY", privateKey], ["JWKS", jwks], ["SITE_URL", siteUrl]]) {
  // NAME=VALUE form, passed as one argument: no shell quoting, and the key's
  // leading "-----BEGIN" is not mistaken for a command-line flag.
  const args = ["convex", "env", "set", `${name}=${value}`, ...(prod ? ["--prod"] : [])];
  const r = spawnSync("npx", args, { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`Could not set ${name}. Is this folder linked to Convex? Run: npx convex dev`);
    process.exit(1);
  }
  console.log(`✓ ${name} set on the ${prod ? "production" : "development"} deployment`);
}
console.log("Sign-in is ready.");
