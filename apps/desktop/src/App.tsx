import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Health = { state: "loading" } | { state: "ok"; status: string } | { state: "error"; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function checkHealth(): Promise<Health> {
  // The Rust host spawns the sidecar; it may still be booting when the window opens,
  // so retry a few times with a short backoff before giving up (spec 001 edge case).
  const port = await invoke<number>("sidecar_port");
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) {
        const body = (await res.json()) as { status: string };
        return { state: "ok", status: body.status };
      }
    } catch {
      // sidecar not up yet
    }
    await sleep(400);
  }
  return { state: "error", message: `sidecar did not respond on port ${port}` };
}

export default function App() {
  const [health, setHealth] = useState<Health>({ state: "loading" });

  useEffect(() => {
    checkHealth().then(setHealth);
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        gap: "10px",
        padding: "40px",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--hc-font-display)", fontSize: 46, fontWeight: 400, margin: 0 }}>
          Habit Chronicle
        </h1>
        <p style={{ color: "var(--hc-text-muted)", marginTop: 8 }}>
          {health.state === "loading" && "contacting sidecar…"}
          {health.state === "ok" && (
            <>
              sidecar status:{" "}
              <strong style={{ color: "var(--hc-done)" }}>{health.status}</strong>
            </>
          )}
          {health.state === "error" && (
            <span style={{ color: "var(--hc-flag-text)" }}>{health.message}</span>
          )}
        </p>
      </div>
    </main>
  );
}
