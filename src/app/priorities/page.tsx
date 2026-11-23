// PENDÊNCIAS (unificação, ordem do Lucas, 2026-11-22): tudo que o
// Lucas tem que fazer, em P1, P2 e P3 pela regra dele de 2026-11-18.
// A lista inicial foi migrada da aba Prioridades da central Criação
// de Conteúdo (lida ao vivo em 2026-11-22: vazia, 0 itens); daqui em
// diante o painel é o lugar de consulta e de trabalho, gravado no
// armazenamento interno (lib/state.ts, rotas /api/tasks).
// Referências de desenho: Linear (faixas de prioridade), Things
// (checklist limpo) e Sunsama (foco no que importa hoje).
import Link from "next/link";
import { effectivePriority, getState, stateConfigured } from "@/lib/state";
import TasksPanel from "@/components/TasksPanel";
import { TZ } from "@/components/viz";

export const dynamic = "force-dynamic";

export default async function PrioritiesPage() {
  const configured = stateConfigured();
  const state = configured ? await getState(0) : null;
  const tasks = state?.tasks ?? [];
  const open = tasks.filter((t) => t.status === "open");
  const counts = ([1, 2, 3] as const).map((p) => open.filter((t) => effectivePriority(t) === p).length);
  const doneCount = tasks.length - open.length;
  const now = new Date().toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ, timeZoneName: "short" });

  return (
    <div className="wrap">
      <Link className="backlink" href="/">← Commander Center</Link>
      <header className="topo">
        <div>
          <div className="heatbar"><i /><i /><i /><i /></div>
          <div className="wordmark">MAGNETIC FUNNELS</div>
          <h1>Priorities</h1>
        </div>
      </header>
      <p className="sub">
        Everything Lucas has to do, ranked by his rule · {open.length} open · {counts[0]} P1 · {counts[1]} P2 · {counts[2]} P3 · {doneCount} completed · updated {now}
      </p>

      {!configured ? (
        <div className="card statuscard">
          <div className="statusbig">Internal storage is not configured yet</div>
          <p className="hint" style={{ marginTop: 8, maxWidth: 560 }}>
            The priorities live in the panel&apos;s own internal storage. It is not answering right now,
            so nothing can be listed or saved.
          </p>
        </div>
      ) : (
        <>
          {tasks.length === 0 && (
            <div className="unvsummary" style={{ marginBottom: 14 }}>
              <b>Starting empty, on purpose:</b> the list was migrated from the Priorities tab of the
              Criação de Conteúdo calendar central, read live on Nov 22, 2026, and it was empty there too.
              From now on, this panel is where priorities are added, worked and completed.
            </div>
          )}
          <TasksPanel initialTasks={tasks} />
          <p className="foot">
            Priorities are stored only inside the Commander Center. The rule: P1 brings clients, money,
            recurring revenue, time saved or leverage; a support ticket is always P3 unless its fix is
            definitive (a tool, an FAQ or a self-serve path).
          </p>
        </>
      )}
    </div>
  );
}
