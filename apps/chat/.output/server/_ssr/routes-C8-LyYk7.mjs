import { n as require_jsx_runtime } from "../_libs/react+tanstack__react-query.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-C8-LyYk7.js
var import_jsx_runtime = require_jsx_runtime();
function Index() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "fixed inset-0 h-dvh w-screen overflow-hidden bg-background",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("iframe", {
			allow: "camera; microphone; autoplay; clipboard-read; clipboard-write; fullscreen",
			className: "h-full w-full border-0",
			referrerPolicy: "same-origin",
			src: "/api/public/embed/",
			title: "Google"
		})
	});
}
//#endregion
export { Index as component };
