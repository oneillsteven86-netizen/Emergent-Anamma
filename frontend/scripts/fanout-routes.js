#!/usr/bin/env node
/**
 * Post-build script:
 *  1) Copies web-static/* (favicons, apple-touch-icon, PWA icons, manifest)
 *     into dist/ so they are deployable.
 *  2) Patches dist/index.html to include multi-resolution favicon link tags,
 *     apple-touch-icon, PWA manifest, and theme colour. Cache-busts the
 *     favicon URLs with the current timestamp so Vercel viewers see the
 *     new ANAM logo immediately after deploy without manual cache clears.
 *  3) Replicates the patched index.html into a folder for every
 *     Expo Router route so static hosts (Vercel, Cloudflare Pages, etc.)
 *     serve the SPA bundle on direct URL visits like /login, /reset,
 *     /guest/<id>, etc. — without needing host-specific rewrites.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const WEB_STATIC = path.join(ROOT, "web-static");
const SRC_INDEX = path.join(DIST, "index.html");

if (!fs.existsSync(SRC_INDEX)) {
  console.error("[fanout] dist/index.html not found — did `expo export` run?");
  process.exit(1);
}

// --- 1. Copy web-static/* into dist/ ---
function copyDirSync(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
      console.log(`[fanout] copied ${path.relative(ROOT, d)}`);
    }
  }
}
copyDirSync(WEB_STATIC, DIST);

// --- 2. Write PWA manifest ---
const manifest = {
  name: "ANAM MMA",
  short_name: "ANAM MMA",
  description: "ANAM MMA — Discipline. Respect. Heart.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#0A0A0A",
  theme_color: "#0A0A0A",
  icons: [
    { src: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
  ],
};
fs.writeFileSync(
  path.join(DIST, "manifest.webmanifest"),
  JSON.stringify(manifest, null, 2)
);
console.log("[fanout] wrote manifest.webmanifest");

// --- 3. Patch index.html: stronger favicon links + manifest + theme + cache-bust ---
const cacheBust = `v=${Date.now()}`;
let html = fs.readFileSync(SRC_INDEX, "utf8");

// Remove the single default favicon link Expo emits.
html = html.replace(
  /<link\s+rel=["']icon["'][^>]*\/?>(\s*<\/link>)?/gi,
  ""
);

// Inject the comprehensive favicon block before </head>.
const headInject = `
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?${cacheBust}" />
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png?${cacheBust}" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico?${cacheBust}" />
  <link rel="shortcut icon" href="/favicon.ico?${cacheBust}" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?${cacheBust}" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#0A0A0A" />
  <meta name="apple-mobile-web-app-title" content="ANAM MMA" />
  <meta name="application-name" content="ANAM MMA" />
`;

html = html.replace(/<\/head>/i, `${headInject}</head>`);

fs.writeFileSync(SRC_INDEX, html);
console.log("[fanout] patched dist/index.html with favicon links");

const indexHtml = html;

// --- 4. Static + dynamic route fan-out ---
const STATIC_ROUTES = [
  "login",
  "reset",
  "waiver",
  "legal",
  "checkin",
  "notifications",
];

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

// SPA fallback at dist root
fs.writeFileSync(path.join(DIST, "404.html"), indexHtml);
console.log("[fanout] wrote 404.html (SPA fallback)");

console.log("[fanout] done.");
