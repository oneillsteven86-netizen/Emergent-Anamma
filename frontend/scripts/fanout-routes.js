#!/usr/bin/env node
/**
 * Post-build script: replicate dist/index.html into a folder for every
 * Expo Router route so static hosts (Vercel, Cloudflare Pages, etc.)
 * serve the SPA bundle on direct URL visits like /login, /reset,
 * /guest/<id>, etc. — without needing host-specific rewrites.
 */
const fs = require("fs");
const path = require("path");

const DIST = path.resolve(__dirname, "..", "dist");
const SRC_INDEX = path.join(DIST, "index.html");

if (!fs.existsSync(SRC_INDEX)) {
  console.error("[fanout] dist/index.html not found — did `expo export` run?");
  process.exit(1);
}

const indexHtml = fs.readFileSync(SRC_INDEX, "utf8");

// Static routes that resolve directly
const STATIC_ROUTES = [
  "login",
  "reset",
  "waiver",
  "legal",
  "checkin",
  "notifications",
];

// Dynamic routes — Vercel won't honour `/guest/[classId]/index.html` as a
// catch-all, so we instead create `/guest/index.html` and the SPA router
// handles the `?param` or path-parsed id once the bundle loads. The link
// emitted in our app uses `/guest/<id>`, which would still 404 unless we
// emit a stand-in at that subpath. We can't enumerate every id at build
// time, so we also rely on Vercel's per-deployment `vercel.json` rewrite
// if present. Best-effort static stub at the directory root:
const STUB_DIRS = ["guest"];

function writeRoute(routePath) {
  const dir = path.join(DIST, routePath);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "index.html");
  fs.writeFileSync(target, indexHtml);
  console.log(`[fanout] wrote ${path.relative(DIST, target)}`);
}

STATIC_ROUTES.forEach(writeRoute);
STUB_DIRS.forEach(writeRoute);

// Also write a 200-OK 404.html so unknown paths still render the SPA
// (Vercel serves a custom 404.html if present at the dist root).
fs.writeFileSync(path.join(DIST, "404.html"), indexHtml);
console.log("[fanout] wrote 404.html (SPA fallback)");

console.log("[fanout] done.");
