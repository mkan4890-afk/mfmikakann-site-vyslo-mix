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

function Index() {
  return (
    <main className="fixed inset-0 h-dvh w-screen overflow-hidden bg-background">
      <iframe
        allow="camera; microphone; autoplay; clipboard-read; clipboard-write; fullscreen"
        className="h-full w-full border-0"
        referrerPolicy="same-origin"
        src="/api/public/embed/"
        title="Google"
      />
    </main>
  );
}
