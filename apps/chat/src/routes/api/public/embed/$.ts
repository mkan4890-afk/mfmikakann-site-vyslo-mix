import { createFileRoute } from "@tanstack/react-router";

const UPSTREAM_ORIGIN = "https://vyslo-mix-chat10041958.edgeone.dev";
const PROXY_PREFIX = "/api/public/embed";

function rewriteText(body: string, contentType: string) {
  let rewritten = body
    .replaceAll(UPSTREAM_ORIGIN, PROXY_PREFIX)
    .replaceAll(UPSTREAM_ORIGIN.replaceAll("/", "\\/"), PROXY_PREFIX.replaceAll("/", "\\/"));

  if (contentType.includes("text/html")) {
    rewritten = rewritten
      .replace(/(<(?:a|link|script|img|source|video|audio|form)\b[^>]*?\s(?:href|src|action|poster)=["'])\/(?!\/)/gi, `$1${PROXY_PREFIX}/`)
      .replace(/(["'`])\/api\//g, `$1${PROXY_PREFIX}/api/`)
      .replace(/(<head(?:\s[^>]*)?>)/i, `$1<base href="${PROXY_PREFIX}/"><meta name="google" content="notranslate">`)
      .replace(/<html(\s[^>]*)?>/i, (m) => (m.includes("translate=") ? m : m.replace(/<html/i, '<html translate="no" class="notranslate"')));
  } else if (contentType.includes("text/css")) {
    rewritten = rewritten.replace(/url\(\s*(["']?)\/(?!\/)/gi, `url($1${PROXY_PREFIX}/`);
  } else if (
    contentType.includes("javascript") ||
    contentType.includes("application/json")
  ) {
    rewritten = rewritten.replace(/(["'`])\/(?!\/|api\/public\/embed\/)/g, `$1${PROXY_PREFIX}/`);
  }

  return rewritten;
}

async function proxyRequest(request: Request, splat = "") {
  const incomingUrl = new URL(request.url);
  const cleanPath = splat.replace(/^\/+/, "");
  const upstreamUrl = new URL(`/${cleanPath}${incomingUrl.search}`, UPSTREAM_ORIGIN);
  const headers = new Headers();

  for (const name of [
    "accept",
    "accept-language",
    "content-type",
    "range",
    "if-none-match",
    "if-modified-since",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  headers.set("referer", `${UPSTREAM_ORIGIN}/`);
  headers.set("user-agent", request.headers.get("user-agent") ?? "Mozilla/5.0");

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    duplex: request.method === "GET" || request.method === "HEAD" ? undefined : "half",
    redirect: "manual",
  } as RequestInit & { duplex?: "half" });

  const responseHeaders = new Headers(upstream.headers);
  for (const name of [
    "content-security-policy",
    "content-security-policy-report-only",
    "x-frame-options",
    "content-encoding",
    "content-length",
    "set-cookie",
  ]) {
    responseHeaders.delete(name);
  }
  responseHeaders.set("cache-control", "no-cache");

  const location = upstream.headers.get("location");
  if (location) {
    const resolved = new URL(location, upstreamUrl);
    responseHeaders.set(
      "location",
      resolved.origin === UPSTREAM_ORIGIN
        ? `${PROXY_PREFIX}${resolved.pathname}${resolved.search}${resolved.hash}`
        : resolved.toString(),
    );
  }

  if (request.method === "HEAD" || upstream.status === 204 || upstream.status === 304) {
    return new Response(null, { status: upstream.status, headers: responseHeaders });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const isText =
    contentType.includes("text/") ||
    contentType.includes("javascript") ||
    contentType.includes("application/json") ||
    contentType.includes("application/xml") ||
    contentType.includes("image/svg+xml");

  if (!isText) {
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  }

  const body = await upstream.text();
  return new Response(rewriteText(body, contentType), {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const Route = createFileRoute("/api/public/embed/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => proxyRequest(request, params._splat),
      HEAD: ({ request, params }) => proxyRequest(request, params._splat),
      POST: ({ request, params }) => proxyRequest(request, params._splat),
      PUT: ({ request, params }) => proxyRequest(request, params._splat),
      PATCH: ({ request, params }) => proxyRequest(request, params._splat),
      DELETE: ({ request, params }) => proxyRequest(request, params._splat),
    },
  },
});