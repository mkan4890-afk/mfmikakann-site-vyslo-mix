import { n as require_jsx_runtime } from "../_libs/react+tanstack__react-query.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-D96GBNZQ.js
var import_jsx_runtime = require_jsx_runtime();
var DIRECT = "https://vyslo-mix-chat10041958.edgeone.dev/";
var PROXY = "/api/public/embed/";
function Index() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "fixed inset-0 h-dvh w-screen overflow-hidden bg-background",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("iframe", {
			allow: "camera; microphone; autoplay; clipboard-read; clipboard-write; fullscreen",
			className: "h-full w-full border-0",
			referrerPolicy: "same-origin",
			src: "/api/public/embed/",
			ref: (f) => {
				if (!f || f.dataset.vp) return;
				f.dataset.vp = "1";
				const c = new AbortController();
				const tm = setTimeout(() => c.abort(), 5e3);
				fetch("https://vyslo-mix-chat10041958.edgeone.dev/api/ipcheck", {
					cache: "no-store",
					signal: c.signal
				}).then((r) => {
					clearTimeout(tm);
					f.src = r.ok ? DIRECT : PROXY;
				}).catch(() => {
					clearTimeout(tm);
					f.src = PROXY;
				});
			},
			title: "Google"
		})
	});
}
//#endregion
export { Index as component };
