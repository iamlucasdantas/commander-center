"use client";

import { useState } from "react";

export default function RefreshButton({ slug, mini }: { slug?: string; mini?: boolean }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    setState("running");
    setMsg("");
    try {
      const res = await fetch(slug ? `/api/refresh?slug=${slug}` : "/api/refresh", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setState("done");
        setMsg("Refresh triggered");
      } else {
        setState("error");
        setMsg(data.error ?? "Nothing to refresh yet");
      }
    } catch {
      setState("error");
      setMsg("Network error");
    }
    setTimeout(() => setState("idle"), 4000);
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button className={mini ? "btn mini" : "btn"} onClick={run} disabled={state === "running"}>
        {state === "running" ? "Refreshing..." : mini ? "Refresh" : "Refresh now"}
      </button>
      {msg && <small style={{ color: state === "error" ? "#FF9D9D" : "#7CE3A8", fontSize: 12 }}>{msg}</small>}
    </span>
  );
}
