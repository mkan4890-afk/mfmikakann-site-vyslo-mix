/**
 * VYSLO MIX static file server
 * Serves static sites (CloudMoon, Utopia) on internal ports.
 *
 * Usage:
 *   STATIC_DIR=./apps/cloudmoon PORT=8004 node static-server.js
 *   STATIC_DIR=./apps/utopia   PORT=8005 SPA_FALLBACK=1 SW_FILE=graph.js node static-server.js
 *
 * - SPA_FALLBACK=1: fall back to index.html for unmatched paths (for /math/* etc.)
 * - SW_FILE=graph.js: set Service-Worker-Allowed: / header for that file
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "8004", 10);
const DIR = path.resolve(process.env.STATIC_DIR || ".");
const SPA_FALLBACK = process.env.SPA_FALLBACK === "1";
const SW_FILE = process.env.SW_FILE || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
  } catch (e) {
    pathname = "/";
  }

  // Prevent path traversal
  const resolved = path.resolve(DIR, "." + pathname);
  if (!resolved.startsWith(DIR + path.sep) && resolved !== DIR) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  let filePath = resolved;

  // Directory → index.html
  if (pathname.endsWith("/") || pathname === "") {
    filePath = path.join(resolved, "index.html");
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA fallback
      if (SPA_FALLBACK) {
        const indexPath = path.join(DIR, "index.html");
        fs.stat(indexPath, (e2, s2) => {
          if (e2 || !s2.isFile()) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            return res.end("Not found");
          }
          serveFile(indexPath, res);
        });
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    serveFile(filePath, res);
  });
});

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";

  const headers = {
    "Content-Type": mime,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };

  // Service Worker header
  if (SW_FILE && path.basename(filePath) === SW_FILE) {
    headers["Service-Worker-Allowed"] = "/";
    headers["Cache-Control"] = "no-cache";
  }

  // Cache classes/* (Ultraviolet bundle)
  if (filePath.includes(path.sep + "classes" + path.sep)) {
    headers["Cache-Control"] = "public, max-age=86400";
  }

  // Cache run-site/images/* (CloudMoon game images)
  if (filePath.includes(path.sep + "run-site" + path.sep + "images" + path.sep)) {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

server.listen(PORT, "127.0.0.1", () => {
  console.log("[static-server] serving " + DIR + " on port " + PORT);
});
