import { r as __toESM } from "../_runtime.mjs";
import { n as require_jsx_runtime, r as require_react, t as QueryClientProvider } from "../_libs/react+tanstack__react-query.mjs";
import { c as HeadContent, d as Outlet, f as lazyRouteComponent, g as useRouter, h as Link, m as createRootRouteWithContext, p as createFileRoute, s as Scripts, u as createRouter } from "../_libs/@tanstack/react-router+[...].mjs";
import { t as QueryClient } from "../_libs/tanstack__query-core.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/router-CTJeEykz.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var styles_default = "/assets/styles-DqJXn63h.css";
function reportLovableError(error, context = {}) {
	if (typeof window === "undefined") return;
	window.__lovableEvents?.captureException?.(error, {
		source: "react_error_boundary",
		route: window.location.pathname,
		...context
	}, {
		mechanism: "react_error_boundary",
		handled: false,
		severity: "error"
	});
	const message = error instanceof Response ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}` : error instanceof Error ? error.message : String(error);
	const stack = error instanceof Error ? error.stack : void 0;
	window.__lovableReportRuntimeError?.({
		message,
		...stack !== void 0 && { stack },
		filename: window.location.pathname
	});
}
function NotFoundComponent() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "flex min-h-screen items-center justify-center bg-background px-4",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "max-w-md text-center",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "text-7xl font-bold text-foreground",
					children: "404"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "mt-4 text-xl font-semibold text-foreground",
					children: "Page not found"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-muted-foreground",
					children: "The page you're looking for doesn't exist or has been moved."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-6",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/",
						className: "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90",
						children: "Go home"
					})
				})
			]
		})
	});
}
function ErrorComponent({ error, reset }) {
	console.error(error);
	const router = useRouter();
	(0, import_react.useEffect)(() => {
		reportLovableError(error, { boundary: "tanstack_root_error_component" });
	}, [error]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "flex min-h-screen items-center justify-center bg-background px-4",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "max-w-md text-center",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "text-xl font-semibold tracking-tight text-foreground",
					children: "This page didn't load"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-muted-foreground",
					children: "Something went wrong on our end. You can try refreshing or head back home."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-6 flex flex-wrap justify-center gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						onClick: () => {
							router.invalidate();
							reset();
						},
						className: "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90",
						children: "Try again"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
						href: "/",
						className: "inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent",
						children: "Go home"
					})]
				})
			]
		})
	});
}
var Route$2 = createRootRouteWithContext()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{
				name: "google",
				content: "notranslate"
			},
			{ title: "Google" },
			{
				name: "description",
				content: "Google"
			},
			{
				property: "og:title",
				content: "Google"
			},
			{
				property: "og:description",
				content: "Google"
			},
			{
				property: "og:type",
				content: "website"
			},
			{
				name: "twitter:card",
				content: "summary_large_image"
			}
		],
		links: [{
			rel: "stylesheet",
			href: styles_default
		}, {
			rel: "icon",
			href: "/favicon.ico",
			sizes: "any"
		}]
	}),
	shellComponent: RootShell,
	component: RootComponent,
	notFoundComponent: NotFoundComponent,
	errorComponent: ErrorComponent
});
function RootShell({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("html", {
		lang: "ja",
		translate: "no",
		className: "notranslate",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("head", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeadContent, {}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("body", { children: [children, /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scripts, {})] })]
	});
}
function RootComponent() {
	const { queryClient } = Route$2.useRouteContext();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(QueryClientProvider, {
		client: queryClient,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {})
	});
}
var $$splitComponentImporter = () => import("./routes-C8-LyYk7.mjs");
var Route$1 = createFileRoute("/")({
	head: () => ({ meta: [
		{ title: "Google" },
		{
			name: "description",
			content: "Google"
		},
		{
			property: "og:title",
			content: "Google"
		},
		{
			property: "og:description",
			content: "Google"
		},
		{
			property: "og:type",
			content: "website"
		},
		{
			name: "twitter:card",
			content: "summary"
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
var UPSTREAM_ORIGIN = "https://vyslo-chat10142245.edgeone.dev";
var PROXY_PREFIX = "/api/public/embed";
function rewriteText(body, contentType) {
	let rewritten = body.replaceAll(UPSTREAM_ORIGIN, PROXY_PREFIX).replaceAll(UPSTREAM_ORIGIN.replaceAll("/", "\\/"), PROXY_PREFIX.replaceAll("/", "\\/"));
	if (contentType.includes("text/html")) rewritten = rewritten.replace(/(<(?:a|link|script|img|source|video|audio|form)\b[^>]*?\s(?:href|src|action|poster)=["'])\/(?!\/)/gi, `$1${PROXY_PREFIX}/`).replace(/(["'`])\/api\//g, `$1${PROXY_PREFIX}/api/`).replace(/(<head(?:\s[^>]*)?>)/i, `$1<base href="${PROXY_PREFIX}/"><meta name="google" content="notranslate">`).replace(/<html(\s[^>]*)?>/i, (m) => m.includes("translate=") ? m : m.replace(/<html/i, "<html translate=\"no\" class=\"notranslate\""));
	else if (contentType.includes("text/css")) rewritten = rewritten.replace(/url\(\s*(["']?)\/(?!\/)/gi, `url($1${PROXY_PREFIX}/`);
	else if (contentType.includes("javascript") || contentType.includes("application/json")) rewritten = rewritten.replace(/(["'`])\/(?!\/|api\/public\/embed\/)/g, `$1${PROXY_PREFIX}/`);
	return rewritten;
}
async function proxyRequest(request, splat = "") {
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
		"if-modified-since"
	]) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	headers.set("referer", `${UPSTREAM_ORIGIN}/`);
	headers.set("user-agent", request.headers.get("user-agent") ?? "Mozilla/5.0");
	const upstream = await fetch(upstreamUrl, {
		method: request.method,
		headers,
		body: request.method === "GET" || request.method === "HEAD" ? void 0 : request.body,
		duplex: request.method === "GET" || request.method === "HEAD" ? void 0 : "half",
		redirect: "manual"
	});
	const responseHeaders = new Headers(upstream.headers);
	for (const name of [
		"content-security-policy",
		"content-security-policy-report-only",
		"x-frame-options",
		"content-encoding",
		"content-length",
		"set-cookie"
	]) responseHeaders.delete(name);
	responseHeaders.set("cache-control", "no-cache");
	const location = upstream.headers.get("location");
	if (location) {
		const resolved = new URL(location, upstreamUrl);
		responseHeaders.set("location", resolved.origin === UPSTREAM_ORIGIN ? `${PROXY_PREFIX}${resolved.pathname}${resolved.search}${resolved.hash}` : resolved.toString());
	}
	if (request.method === "HEAD" || upstream.status === 204 || upstream.status === 304) return new Response(null, {
		status: upstream.status,
		headers: responseHeaders
	});
	const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
	if (!(contentType.includes("text/") || contentType.includes("javascript") || contentType.includes("application/json") || contentType.includes("application/xml") || contentType.includes("image/svg+xml"))) return new Response(upstream.body, {
		status: upstream.status,
		headers: responseHeaders
	});
	const body = await upstream.text();
	return new Response(rewriteText(body, contentType), {
		status: upstream.status,
		headers: responseHeaders
	});
}
var Route = createFileRoute("/api/public/embed/$")({ server: { handlers: {
	GET: ({ request, params }) => proxyRequest(request, params._splat),
	HEAD: ({ request, params }) => proxyRequest(request, params._splat),
	POST: ({ request, params }) => proxyRequest(request, params._splat),
	PUT: ({ request, params }) => proxyRequest(request, params._splat),
	PATCH: ({ request, params }) => proxyRequest(request, params._splat),
	DELETE: ({ request, params }) => proxyRequest(request, params._splat)
} } });
var rootRouteChildren = {
	IndexRoute: Route$1.update({
		id: "/",
		path: "/",
		getParentRoute: () => Route$2
	}),
	ApiPublicEmbedSplatRoute: Route.update({
		id: "/api/public/embed/$",
		path: "/api/public/embed/$",
		getParentRoute: () => Route$2
	})
};
var routeTree = Route$2._addFileChildren(rootRouteChildren)._addFileTypes();
var getRouter = () => {
	const queryClient = new QueryClient();
	return createRouter({
		routeTree,
		context: { queryClient },
		scrollRestoration: true,
		defaultPreloadStaleTime: 0
	});
};
//#endregion
export { getRouter };
