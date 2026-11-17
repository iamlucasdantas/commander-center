import { ACCOUNTS, type Account } from "@/lib/accounts";
import RefreshButton from "@/components/RefreshButton";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<Account["kind"], string> = {
  empresa: "Empresa",
  comunidade: "Comunidade",
  cliente: "Cliente",
  projeto: "Projeto",
  potencial: "Potencial",
};

function statusOf(a: Account): { label: string; cls: string } {
  if (a.sourceStatus === "hl-location") {
    const configured = a.pitEnv ? Boolean(process.env[a.pitEnv]) : false;
    return configured
      ? { label: "Pronta pra coletar", cls: "pronta" }
      : { label: "Aguardando token", cls: "token" };
  }
  if (a.sourceStatus === "propria") return { label: "Fonte própria", cls: "propria" };
  if (a.sourceStatus === "sem-subconta") return { label: "Sem conta ainda", cls: "semconta" };
  return { label: "Fonte a mapear", cls: "mapear" };
}

function fonte(a: Account): string {
  if (a.sourceStatus === "hl-location") return "HighLevel, location própria";
  if (a.sourceStatus === "propria") return "App próprio (API)";
  if (a.sourceStatus === "sem-subconta") return "Nenhuma por enquanto";
  return "A definir";
}

export default function Home() {
  const contas = ACCOUNTS.filter((a) => a.kind !== "potencial");
  const comLocation = contas.filter((a) => a.sourceStatus === "hl-location");
  const prontas = comLocation.filter((a) => a.pitEnv && process.env[a.pitEnv]);
  const aguardandoToken = comLocation.length - prontas.length;
  const aMapear = contas.filter((a) => a.sourceStatus === "mapear");
  const semConta = contas.filter((a) => a.sourceStatus === "sem-subconta");
  const grupos: Array<{ titulo: string; kinds: Account["kind"][] }> = [
    { titulo: "Empresa e comunidade", kinds: ["empresa", "comunidade"] },
    { titulo: "Clientes", kinds: ["cliente"] },
    { titulo: "Marcas e projetos próprios", kinds: ["projeto"] },
  ];

  return (
    <div className="wrap">
      <header className="topo">
        <h1><span className="magnet">🧲 Commander</span> Center</h1>
        <span style={{ marginLeft: "auto" }}><RefreshButton /></span>
      </header>
      <p className="sub">Tudo que está acontecendo nas suas contas, num lugar só. Leads, acessos e conversas entram aqui assim que cada fonte é ligada.</p>

      <div className="kpis">
        <div className="card"><div className="label">Contas no painel</div><div className="value">{contas.length}</div><div className="hint">12 clientes, empresa, comunidade e projetos</div></div>
        <div className="card"><div className="label">Com location no HighLevel</div><div className="value">{comLocation.length}</div><div className="hint">coleta pronta pra ligar</div></div>
        <div className="card"><div className="label">Prontas pra coletar</div><div className="value">{prontas.length}</div><div className={prontas.length ? "up" : "warn"}>{prontas.length ? "token configurado" : "nenhum token configurado ainda"}</div></div>
        <div className="card"><div className="label">Aguardando token</div><div className="value">{aguardandoToken}</div><div className="warn">só falta você colar no Vercel</div></div>
        <div className="card"><div className="label">Fontes a mapear</div><div className="value">{aMapear.length}</div><div className="hint">clientes sem location própria</div></div>
        <div className="card"><div className="label">Sem conta ainda</div><div className="value">{semConta.length + 1}</div><div className="hint">Fresh Air, Olivo, Electric, Landscaping</div></div>
      </div>

      {aguardandoToken > 0 && (
        <div className="alert"><b>⚠ O que destrava tudo:</b> {aguardandoToken} contas já têm location no HighLevel e estrutura pronta. Falta só colar o token (PIT) de cada uma nas variáveis de ambiente do Vercel. O passo a passo está no README-credenciais do repositório. Com o token salvo, a coleta liga e os números de leads, acessos e conversas passam a aparecer aqui.</div>
      )}
      {aMapear.length > 0 && (
        <div className="alert"><b>⚠ Mapeamento:</b> {aMapear.length} frentes ainda não têm fonte de leads definida, a maioria clientes cujo lead cai em outra subconta ou sistema. A gente mapeia um a um e eles entram no painel.</div>
      )}

      {grupos.map((g) => (
        <section key={g.titulo}>
          <h2>{g.titulo}</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Conta</th><th>Tipo</th><th>Fonte de dados</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {contas.filter((a) => g.kinds.includes(a.kind)).map((a) => {
                  const st = statusOf(a);
                  const canRefresh = a.sourceStatus === "hl-location" || a.sourceStatus === "propria";
                  return (
                    <tr key={a.slug}>
                      <td><b>{a.name}</b>{a.note && <small className="note">{a.note}</small>}</td>
                      <td>{KIND_LABEL[a.kind]}</td>
                      <td>{fonte(a)}</td>
                      <td><span className={`pill ${st.cls}`}>{st.label}</span></td>
                      <td>{canRefresh && <RefreshButton slug={a.slug} mini />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <h2>Onde estamos</h2>
      <div className="card">
        <ul className="steps">
          <li><span className="done">✓</span> Painel no ar, GitHub e Vercel ligados, deploy automático a cada push</li>
          <li><span className="done">✓</span> Lista definitiva de contas, 12 clientes e 14 projetos, registrada no painel</li>
          <li><span className="done">✓</span> Botão de atualizar na hora, no painel todo ou por conta</li>
          <li><span className="todo">→</span> Você cola os tokens do HighLevel no Vercel (9 variáveis, passo a passo no repositório)</li>
          <li><span className="todo">→</span> Coleta liga: leads com nome e origem, fakes fora das métricas, acessos cruzados com leads</li>
          <li><span className="todo">→</span> Mapeamento das fontes dos clientes sem location, um a um</li>
        </ul>
      </div>

      <p className="foot">Commander Center. Os números de leads e acessos aparecem por conta assim que a fonte dela é ligada.</p>
    </div>
  );
}
