"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { money, moneyShort } from "@/lib/insights";
import { fmtAge } from "@/lib/v2data";
import { V2_HEALTH_COLOR, type V2HealthLevel } from "@/lib/v2insights";

export interface AccountRow {
  slug: string;
  name: string;
  segment: string; // Clients | My brands | Community
  segmentKey: string;
  healthLevel: V2HealthLevel;
  healthLabel: string;
  healthReason: string;
  contacts: number; // verificados, no período escolhido
  contactsDelta: number | null; // % vs período anterior
  waiting: number;
  waitingOldestMin: number | null;
  idleValue: number;
  idleCount: number;
  openValue: number;
  openCount: number;
  won30Value: number;
  won30Count: number;
  fakeCount: number;
  risk: number; // ordenação padrão (risco)
  diagnosis: string;
  hlDashboard: string;
}

type SortKey = "risk" | "name" | "status" | "contacts" | "waiting" | "idle";

const HEALTH_ORDER: Record<V2HealthLevel, number> = { act: 4, watch: 3, nobaseline: 2, flowing: 1 };

export default function AccountsTable({ rows, periodLabel }: { rows: AccountRow[]; periodLabel: string }) {
  const [sort, setSort] = useState<SortKey>("risk");
  const [selected, setSelected] = useState<AccountRow | null>(null);

  const sorted = useMemo(() => {
    const arr = [...rows];
    switch (sort) {
      case "name": return arr.sort((a, b) => a.name.localeCompare(b.name));
      case "status": return arr.sort((a, b) => HEALTH_ORDER[b.healthLevel] - HEALTH_ORDER[a.healthLevel] || b.idleValue - a.idleValue);
      case "contacts": return arr.sort((a, b) => b.contacts - a.contacts);
      case "waiting": return arr.sort((a, b) => b.waiting - a.waiting || (b.waitingOldestMin ?? 0) - (a.waitingOldestMin ?? 0));
      case "idle": return arr.sort((a, b) => b.idleValue - a.idleValue);
      default: return arr.sort((a, b) => b.risk - a.risk);
    }
  }, [rows, sort]);

  const head = (key: SortKey, label: string) => (
    <th onClick={() => setSort(key)} title="Sort by this column">
      {label}{sort === key ? " ↓" : ""}
    </th>
  );

  return (
    <>
      <div className="v2-tablewrap">
        <table className="v2-table">
          <thead>
            <tr>
              {head("name", "Account")}
              {head("status", "Status")}
              {head("contacts", `Contacts · ${periodLabel}`)}
              {head("waiting", "Waiting")}
              {head("idle", "Idle $")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.slug} onClick={() => setSelected(r)}>
                <td>
                  <b>{r.name}</b>
                  <span className="v2-seg">{r.segment}</span>
                </td>
                <td>
                  <span className="v2-status">
                    <span className="hdot" style={{ background: V2_HEALTH_COLOR[r.healthLevel] }} />
                    {r.healthLabel}
                  </span>
                  <span className="v2-reason">{r.healthReason}</span>
                </td>
                <td>
                  <span className="cellnum">{r.contacts}</span>
                  {r.contactsDelta !== null && (
                    <span className={r.contactsDelta > 0 ? "up" : r.contactsDelta < 0 ? "down" : "hint"} style={{ marginLeft: 8, fontSize: 12 }}>
                      {r.contactsDelta > 0 ? "▲" : r.contactsDelta < 0 ? "▼" : ""} {Math.abs(r.contactsDelta)}%
                    </span>
                  )}
                </td>
                <td>
                  {r.waiting > 0 ? (
                    <span className={r.waitingOldestMin !== null && r.waitingOldestMin > 24 * 60 ? "down" : "warn"} style={{ fontWeight: 700 }}>
                      {r.waiting}
                      <small className="note">oldest {r.waitingOldestMin !== null ? fmtAge(r.waitingOldestMin) : ""}</small>
                    </span>
                  ) : 0}
                </td>
                <td>{r.idleValue > 0 ? money(r.idleValue) : "$0"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <>
          <div className="v2-drawerback" onClick={() => setSelected(null)} />
          <aside className="v2-drawer" aria-label={`Details for ${selected.name}`}>
            <button type="button" className="v2-close" onClick={() => setSelected(null)} aria-label="Close">✕</button>
            <h3>{selected.name}</h3>
            <p style={{ marginTop: 8 }}>
              <span className="v2-status">
                <span className="hdot" style={{ background: V2_HEALTH_COLOR[selected.healthLevel] }} />
                {selected.healthLabel}
              </span>
              <span className="v2-reason" style={{ maxWidth: "none" }}>{selected.healthReason}</span>
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "#FCE3D4", margin: "12px 0 6px" }}>{selected.diagnosis}</p>
            <div style={{ marginTop: 10 }}>
              <div className="v2-drow"><span>Waiting for reply<small>verified leads only</small></span><b>{selected.waiting}</b></div>
              <div className="v2-drow"><span>Oldest wait</span><b>{selected.waitingOldestMin !== null ? fmtAge(selected.waitingOldestMin) : "—"}</b></div>
              <div className="v2-drow"><span>Open pipeline<small>{selected.openCount} opportunities</small></span><b>{money(selected.openValue)}</b></div>
              <div className="v2-drow"><span>Idle 14d+<small>{selected.idleCount} opportunities</small></span><b>{money(selected.idleValue)}</b></div>
              <div className="v2-drow"><span>Won · 30 days<small>{selected.won30Count} opportunities</small></span><b>{money(selected.won30Value)}</b></div>
              <div className="v2-drow"><span>Fakes quarantined<small>last 30 days</small></span><b>{selected.fakeCount}</b></div>
            </div>
            <div className="v2-qactions" style={{ marginTop: 18 }}>
              <Link className="btnlink" href={`/v2/account/${selected.slug}`}>Open account page</Link>
              <a className="btn mini" href={selected.hlDashboard} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "inline-block" }}>
                Open in HighLevel
              </a>
            </div>
            <p className="hint" style={{ marginTop: 14, fontSize: 12, color: "#8A7A70" }}>
              {moneyShort(selected.idleValue)} idle is the money sitting still in this account.
            </p>
          </aside>
        </>
      )}
    </>
  );
}
