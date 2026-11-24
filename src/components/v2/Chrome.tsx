"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface SearchEntry {
  kind: "account" | "contact";
  label: string;
  sub: string;
  href: string;
}

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
] as const;

function SearchBox({ index }: { index: SearchEntry[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const digits = query.replace(/\D/g, "");
    return index
      .filter((e) => {
        if (e.label.toLowerCase().includes(query) || e.sub.toLowerCase().includes(query)) return true;
        return digits.length >= 3 && e.sub.replace(/\D/g, "").includes(digits);
      })
      .slice(0, 8);
  }, [q, index]);

  return (
    <div className="v2-search">
      <input
        ref={inputRef}
        type="text"
        value={q}
        placeholder="Search account, contact or phone  (⌘K)"
        aria-label="Search accounts, contacts and phones"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results.length > 0) {
            router.push(results[0].href);
            setOpen(false);
          }
        }}
      />
      {open && q.trim() && (
        <div className="v2-results">
          {results.length ? results.map((r, i) => (
            <Link className="v2-result" href={r.href} key={`${r.href}-${i}`} onClick={() => setOpen(false)}>
              <span className="kind">{r.kind}</span> {r.label}
              <small>{r.sub}</small>
            </Link>
          )) : (
            <div className="v2-result">No match in the collected window<small>Search covers live accounts and their recent verified contacts</small></div>
          )}
        </div>
      )}
    </div>
  );
}

function PeriodSwitch() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const current = params.get("period") ?? "7d";
  return (
    <div className="v2-period" role="group" aria-label="Period">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          type="button"
          className={current === p.key ? "on" : ""}
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            if (p.key === "7d") next.delete("period");
            else next.set("period", p.key);
            const qs = next.toString();
            router.push(pathname === "/v2" ? `/v2${qs ? `?${qs}` : ""}` : `/v2?period=${p.key}`);
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function RefreshBtn() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const router = useRouter();
  async function run() {
    setState("running");
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      setState(res.ok ? "done" : "error");
      if (res.ok) setTimeout(() => router.refresh(), 1200);
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 5000);
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button type="button" className="btn" onClick={run} disabled={state === "running"}>
        {state === "running" ? "Refreshing..." : "Refresh"}
      </button>
      {state === "done" && <small style={{ color: "#7CE3A8", fontSize: 12 }}>Refresh triggered</small>}
      {state === "error" && <small style={{ color: "#FF9D9D", fontSize: 12 }}>Refresh unavailable</small>}
    </span>
  );
}

const NAV = [
  { href: "/v2", label: "Cockpit", match: (p: string) => p === "/v2" },
  { href: "/v2#accounts", label: "Accounts", match: (p: string) => p.startsWith("/v2/account") },
  { href: "/v2/waiting", label: "Waiting for reply", match: (p: string) => p === "/v2/waiting", badge: true },
  { href: "/v2/agency", label: "Agency business", match: (p: string) => p === "/v2/agency" },
  { href: "/v2/social", label: "Social & sites", match: (p: string) => p === "/v2/social" },
  { href: "/v2/log", label: "Log", match: (p: string) => p === "/v2/log" },
];

export default function Chrome({
  waitingTotal,
  index,
  updatedLabel,
  children,
}: {
  waitingTotal: number;
  index: SearchEntry[];
  updatedLabel: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="v2-shell">
      <aside className="v2-side">
        <div className="v2-brand">
          <div className="heatbar"><i /><i /><i /><i /></div>
          <div className="wordmark">MAGNETIC FUNNELS</div>
          <div className="v2-brandname">Commander <span className="flame">Center 2.0</span></div>
        </div>
        {NAV.map((n) => (
          <Link key={n.label} href={n.href} className={`v2-navitem${n.match(pathname) ? " on" : ""}`}>
            {n.label}
            {n.badge && waitingTotal > 0 ? <span className="v2-badge">{waitingTotal}</span> : null}
          </Link>
        ))}
        <div className="v2-sidefoot">
          Commander Center 2.0 is the home since Nov 24, 2026.
          <br />
          <Link href="/v1">Previous version (v1, until Dec 24)</Link>
        </div>
      </aside>
      <div className="v2-main">
        <div className="v2-top">
          <SearchBox index={index} />
          <PeriodSwitch />
          <RefreshBtn />
          <span className="v2-updated">{updatedLabel}</span>
        </div>
        <div className="v2-content">{children}</div>
      </div>
    </div>
  );
}
