// AGENDA (unificação, ordem do Lucas, 2026-11-22): o que vai
// acontecer, numa tela só. Outlook (primário), Google Calendar e
// calendários do HighLevel, deduplicados favorecendo o Outlook pelo
// coletor diário (lib/command.ts), mais os rituais semanais e o
// bloco protegido diário de criação de conteúdo (lib/agenda.ts).
// Referências de desenho: Google Calendar (clareza da lista),
// Sunsama (o dia num relance, próximo compromisso em destaque) e
// Motion (densidade da semana). Tudo em America/Chicago.
import Link from "next/link";
import { getCommand } from "@/lib/command";
import {
  SOURCE_LABEL, addDays, buildDay, buildDays, chicagoDateStr, chicagoInstant,
  fmtTime, freeMinutesToday, nextItem, weekdayOf, type AgendaItem,
} from "@/lib/agenda";
import { TZ } from "@/components/viz";

export const dynamic = "force-dynamic";

function dayLabel(dateStr: string): string {
  return chicagoInstant(dateStr, "12:00").toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", timeZone: TZ,
  });
}

function dayShort(dateStr: string): string {
  return chicagoInstant(dateStr, "12:00").toLocaleDateString("en-US", {
    weekday: "short", timeZone: TZ,
  });
}

function relWhen(item: AgendaItem, now: Date): string {
  const start = new Date(item.start).getTime();
  const end = new Date(item.end).getTime();
  if (now.getTime() >= start && now.getTime() < end) return "Happening now";
  const mins = Math.round((start - now.getTime()) / 60_000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h ${String(mins % 60).padStart(2, "0")}m`;
  return `${dayLabel(chicagoDateStr(new Date(item.start)))} · ${fmtTime(item.start)}`;
}

function chips(item: AgendaItem) {
  return (
    <span className="tl-meta">
      {item.allDay && <span className="srcchip allday">All day</span>}
      {item.kind === "event" && item.source && (
        <span className={`srcchip ${item.source}`}>{SOURCE_LABEL[item.source]}</span>
      )}
      {item.kind === "ritual" && <span className="srcchip ritual">Weekly ritual</span>}
      {item.kind === "content" && <span className="srcchip content">Protected block</span>}
      {item.calendar && <span>{item.calendar}</span>}
      {item.location && <span>{item.location}</span>}
      {item.lateWed && <span className="srcchip latewed">Runs past 3:00 PM · Academy at 4:00 PM</span>}
    </span>
  );
}

export default async function AgendaPage() {
  const command = await getCommand();
  const agenda = command.agenda;
  const now = new Date();
  const today = chicagoDateStr(now);
  const todayDay = buildDay(agenda, today);
  const next = nextItem(agenda, now);
  const freeMin = freeMinutesToday(agenda, now);
  const weekStart = addDays(today, -((weekdayOf(today) + 6) % 7)); // segunda da semana atual
  const weekDays = buildDays(agenda, weekStart, 7);
  const weekCount = weekDays.reduce((s, d) => s + d.items.length, 0);
  const maxWeek = Math.max(1, ...weekDays.map((d) => d.items.length));
  const nextDays = buildDays(agenda, addDays(today, 1), 7);

  // Linha do "agora" na linha do tempo de hoje: depois do último item já encerrado.
  const nowMs = now.getTime();
  let nowIndex = todayDay.items.findIndex((i) => new Date(i.end).getTime() > nowMs);
  if (nowIndex === -1) nowIndex = todayDay.items.length;

  const collectedLabel = agenda
    ? new Date(agenda.collectedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ })
    : null;

  return (
    <div className="wrap">
      <Link className="backlink" href="/">← Commander Center</Link>
      <header className="topo">
        <div>
          <div className="heatbar"><i /><i /><i /><i /></div>
          <div className="wordmark">MAGNETIC FUNNELS</div>
          <h1>Agenda</h1>
        </div>
      </header>
      <p className="sub">
        Outlook first, then Google and HighLevel, duplicates removed
        {agenda ? <> · snapshot {collectedLabel} (Chicago) · {agenda.counts.outlook} Outlook · {agenda.counts.google} Google · {agenda.counts.highlevel} HighLevel · {agenda.counts.duplicatesRemoved} duplicates removed</> : null}
      </p>

      {!agenda ? (
        <div className="card statuscard">
          <div className="statusbig">Waiting for the first agenda snapshot</div>
          <p className="hint" style={{ marginTop: 8, maxWidth: 560 }}>
            The daily collector reads Outlook, Google Calendar and the HighLevel calendars,
            removes duplicates favoring Outlook and records the snapshot here. None has arrived yet.
          </p>
        </div>
      ) : (
        <>
          {agenda.errors.length > 0 && (
            <div className="unvsummary" style={{ marginBottom: 14 }}>
              <b>Partial snapshot:</b> {agenda.errors.join(" · ")}
            </div>
          )}

          <div className="hero">
            <div className="hero-main">
              <div className="label">Next up</div>
              {next ? (
                <>
                  <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 30, lineHeight: 1.15, margin: "8px 0 6px" }}>{next.title}</div>
                  <div className="up" style={{ fontSize: 15 }}>{relWhen(next, now)}</div>
                  <div className="hint" style={{ marginTop: 6 }}>
                    {next.allDay ? "All day" : `${fmtTime(next.start)} – ${fmtTime(next.end)}`}
                    {next.kind === "event" && next.source ? ` · ${SOURCE_LABEL[next.source]}` : next.kind === "ritual" ? " · Weekly ritual" : " · Protected block"}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 30, lineHeight: 1.15, margin: "8px 0 6px" }}>Nothing scheduled</div>
                  <div className="hint">No event or ritual in the next 14 days.</div>
                </>
              )}
            </div>
            <div style={{ display: "grid", gap: 12, flex: 1, minWidth: 240 }}>
              <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
                <div>
                  <div className="label" style={{ color: "#B7A69B", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Today</div>
                  <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 30 }}>{todayDay.items.length}</div>
                  <div className="hint">events & rituals</div>
                </div>
                <div>
                  <div className="label" style={{ color: "#B7A69B", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Free today</div>
                  <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 30 }}>{Math.floor(freeMin / 60)}h {String(freeMin % 60).padStart(2, "0")}m</div>
                  <div className="hint">between 7:00 AM and 7:00 PM</div>
                </div>
                <div>
                  <div className="label" style={{ color: "#B7A69B", fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>This week</div>
                  <div style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 30 }}>{weekCount}</div>
                  <div className="hint">Mon to Sun, all sources</div>
                </div>
              </div>
              <div className="weekstrip">
                {weekDays.map((d) => (
                  <div className={`ws-day${d.date === today ? " today" : ""}`} key={d.date}>
                    <div className="ws-dow">{dayShort(d.date)}</div>
                    <div className="ws-num">{d.date.slice(8)}</div>
                    <div className="ws-count">{d.items.length} item{d.items.length === 1 ? "" : "s"}</div>
                    <div className="ws-track"><i style={{ width: `${Math.round((d.items.length / maxWeek) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <h2>Today · {dayLabel(today)}</h2>
          <div className="card">
            {todayDay.items.length ? (
              <div className="tl">
                {todayDay.items.map((item, i) => {
                  const past = !item.allDay && new Date(item.end).getTime() <= nowMs;
                  const isNow = !item.allDay && new Date(item.start).getTime() <= nowMs && new Date(item.end).getTime() > nowMs;
                  return (
                    <div key={item.key}>
                      {i === nowIndex && (
                        <div className="tl-now"><b /><span>Now · {fmtTime(now.toISOString())}</span><i /></div>
                      )}
                      <div className={`tl-row${past ? " past" : ""}${isNow ? " nowitem" : ""}${item.kind === "content" ? " contentitem" : ""}`}>
                        <div className="tl-time">
                          {item.allDay ? <b>All day</b> : (<><b>{fmtTime(item.start)}</b>{fmtTime(item.end)}</>)}
                        </div>
                        <div className="tl-body">
                          <div className="tl-title">{item.title}</div>
                          {chips(item)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {nowIndex === todayDay.items.length && todayDay.items.length > 0 && (
                  <div className="tl-now"><b /><span>Now · {fmtTime(now.toISOString())}</span><i /></div>
                )}
              </div>
            ) : (
              <p style={{ fontSize: 14, color: "#B7A69B" }}>Nothing on the agenda today.</p>
            )}
          </div>

          <h2>Next 7 days</h2>
          {nextDays.map((d) => (
            <div key={d.date}>
              <div className="dayhead">
                <h3>{dayLabel(d.date)}</h3>
                <span>{d.items.length} item{d.items.length === 1 ? "" : "s"}</span>
              </div>
              <div className="card" style={{ padding: "6px 20px" }}>
                {d.items.length ? d.items.map((item) => (
                  <div className="tl-row" key={item.key} style={{ gridTemplateColumns: "118px 1fr" }}>
                    <div className="tl-time">
                      {item.allDay ? <b>All day</b> : (<><b>{fmtTime(item.start)}</b>{fmtTime(item.end)}</>)}
                    </div>
                    <div className="tl-body">
                      <div className="tl-title">{item.title}</div>
                      {chips(item)}
                    </div>
                  </div>
                )) : (
                  <p style={{ fontSize: 13.5, color: "#8A7A70", padding: "8px 0" }}>Nothing scheduled.</p>
                )}
              </div>
            </div>
          ))}

          <p className="foot">
            Agenda from the daily collector snapshot (Outlook, Google Calendar and HighLevel), Chicago time.
            Rituals and the protected content block are standing rules, shown generated; a real event at the same time replaces them.
          </p>
        </>
      )}
    </div>
  );
}
