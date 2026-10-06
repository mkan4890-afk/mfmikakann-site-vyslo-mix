import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Google" },
      { name: "description", content: "Google" },
      { property: "og:title", content: "Google" },
      { property: "og:description", content: "Google" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const DIRECT = "https://vyslo-mix-chat10041958.edgeone.dev/";
const PROXY = "/api/public/embed/";

function Index() {
  return (
    <main className="fixed inset-0 h-dvh w-screen overflow-hidden bg-background">
      <iframe
        allow="camera; microphone; autoplay; clipboard-read; clipboard-write; fullscreen"
        className="h-full w-full border-0"
        referrerPolicy="same-origin"
        src="about:blank"
        ref={(f) => {
          // まずユーザーの端末から直接チャットに接続できるか確認する（端末のIPで開く）。
          // 直接つながらないネットワークでは、従来どおりサーバー経由の表示に切り替える。
          if (!f || f.dataset.vp) return;
          f.dataset.vp = "1";
          const c = new AbortController();
          const tm = setTimeout(() => c.abort(), 5000);
          fetch(DIRECT + "api/ipcheck", { cache: "no-store", signal: c.signal })
            .then((r) => { clearTimeout(tm); f.src = r.ok ? DIRECT : PROXY; })
            .catch(() => { clearTimeout(tm); f.src = PROXY; });
        }}
        title="Google"
      />
    </main>
  );
}
