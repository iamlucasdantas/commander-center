// Componentes visuais compartilhados entre a home e a página da conta.
// Server-rendered (SVG puro, sem JS no cliente), no branding oficial.
import { pctChange } from "@/lib/insights";

/** Todo horário visível no painel é America/Chicago, nunca o UTC do servidor. */
export const TZ = "America/Chicago";

/** Sparkline SVG a partir de uma série diária. Server-rendered, sem JS.
 *  showPeak desenha o valor do pico no canto: é a escala mínima legível. */
export function Spark({ data, w = 110, h = 30, stroke = "#F0772E", fill = true, showPeak = false }: {
  data: number[]; w?: number; h?: number; stroke?: string; fill?: boolean; showPeak?: boolean;
}) {
  const max = Math.max(1, ...data);
  const top = showPeak ? 12 : 3;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - (v / max) * (h - 3 - top)).toFixed(1)}`);
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ display: "block" }}>
      {fill && <polygon points={area} fill={stroke} opacity="0.14" />}
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
      {showPeak && <text x={w - 1} y={9} textAnchor="end" fontSize="9" fill="#B7A69B">peak {max}</text>}
    </svg>
  );
}

/** Chip de variação contra o período anterior. invert=true quando subir é ruim (ex.: não lidas). */
export function Delta({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  const pct = pctChange(cur, prev);
  if (pct === null) return <span className="hint">no baseline yet</span>;
  if (pct === 0) return <span className="hint">flat vs previous period</span>;
  const good = invert ? pct < 0 : pct > 0;
  return (
    <span className={good ? "up" : "down"}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}% vs previous period
    </span>
  );
}

/** Anel de progresso genérico (saúde, conexão). */
export function Ring({ pct, color, center, size = 40 }: { pct: number; color: string; center: string; size?: number }) {
  const r = size / 2 - 4;
  const C = 2 * Math.PI * r;
  const c = size / 2;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="#2B2320" strokeWidth="4.5" />
      <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth="4.5" strokeLinecap="round"
        strokeDasharray={`${(clamped / 100) * C} ${C}`} transform={`rotate(-90 ${c} ${c})`} />
      <text x={c} y={c + 4} textAnchor="middle" fontSize={size >= 44 ? 13 : 11} fontWeight="700" fill="#FCE3D4">{center}</text>
    </svg>
  );
}

/** Paleta das fatias (donut de tipos): chama da marca + apoios. */
export const PIE_COLORS = ["#F0772E", "#EB611C", "#FFD97C", "#3DDC84", "#7CC4FF", "#C9A7FF", "#FF6B6B", "#8AD6C2"];

/** Donut de fatias server-rendered (SVG puro): um arco por fatia, na
 *  ordem dada. Fatia pode trazer a própria cor (ex.: "não registrado"). */
export function Pie({ slices, size = 150, thickness = 21, centerTop, centerBottom }: {
  slices: { label: string; value: number; color?: string }[];
  size?: number; thickness?: number; centerTop?: string; centerBottom?: string;
}) {
  const total = slices.reduce((sum, x) => sum + x.value, 0);
  const r = size / 2 - thickness / 2 - 2;
  const C = 2 * Math.PI * r;
  const c = size / 2;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="#2B2320" strokeWidth={thickness} />
      {total > 0 && slices.map((sl, i) => {
        const frac = sl.value / total;
        const dash = `${Math.max(0, frac * C - 2.5)} ${C}`;
        const off = -acc * C;
        acc += frac;
        return (
          <circle key={i} cx={c} cy={c} r={r} fill="none" strokeWidth={thickness}
            stroke={sl.color ?? PIE_COLORS[i % PIE_COLORS.length]}
            strokeDasharray={dash} strokeDashoffset={off} transform={`rotate(-90 ${c} ${c})`} />
        );
      })}
      {centerTop && <text x={c} y={c} textAnchor="middle" fontSize="19" fontWeight="800" fill="#FCE3D4">{centerTop}</text>}
      {centerBottom && <text x={c} y={c + 15} textAnchor="middle" fontSize="9.5" fill="#B7A69B">{centerBottom}</text>}
    </svg>
  );
}

export const HEALTH_COLOR = { green: "#3DDC84", yellow: "#FFD97C", red: "#FF6B6B" } as const;

/** Gráfico principal: área em gradiente chama (30d) + linha tracejada do
 *  período anterior, com eixos rotulados (padrão Stripe/ChartMogul). */
export function HeroChart({ cur, prev }: { cur: number[]; prev: number[] }) {
  const W = 640, H = 208, X0 = 44, X1 = 632, YT = 14, YB = 168;
  const max = Math.max(1, ...cur, ...prev);
  const x = (i: number) => X0 + (i / (cur.length - 1)) * (X1 - X0);
  const y = (v: number) => YB - (v / max) * (YB - YT);
  const line = (s: number[]) => s.map((v, i) => `${x(i).toFixed(0)},${y(v).toFixed(0)}`).join(" ");
  const area = `${X0},${YB} ${line(cur)} ${X1},${YB}`;
  const grid = [...new Set([0, Math.max(1, Math.round(max / 2)), max])];
  const dayLabel = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} role="img" aria-label="Daily leads, last 30 days compared with the previous 30 days">
      <defs>
        <linearGradient id="flameFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#EB611C" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#C0240A" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {grid.map((v) => (
        <g key={v}>
          <line x1={X0} x2={X1} y1={y(v)} y2={y(v)} stroke="#2B2320" strokeWidth="1" />
          <text x={X0 - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#B7A69B">{v}</text>
        </g>
      ))}
      <polygon points={area} fill="url(#flameFill)" />
      <polyline points={line(prev)} fill="none" stroke="#8A7A70" strokeWidth="2" strokeDasharray="5 4" />
      <polyline points={line(cur)} fill="none" stroke="#F0772E" strokeWidth="2.5" strokeLinejoin="round" />
      <text x={X0 + 2} y={YT + 4} fontSize="10.5" fill="#B7A69B">peak {Math.max(...cur)}/day</text>
      <text x={x(0)} y={192} fontSize="11" fill="#B7A69B">{dayLabel(29)}</text>
      <text x={x(15)} y={192} textAnchor="middle" fontSize="11" fill="#B7A69B">{dayLabel(14)}</text>
      <text x={x(29)} y={192} textAnchor="end" fontSize="11" fill="#B7A69B">Today, {dayLabel(0)}</text>
    </svg>
  );
}
