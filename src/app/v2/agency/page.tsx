import { ACCOUNTS, hasToken } from "@/lib/accounts";
import { fetchAllV2 } from "@/lib/v2data";
import { money } from "@/lib/insights";

export const dynamic = "force-dynamic";

/**
 * Agency business (etapa 5 da spec): a receita do SaaS do Lucas.
 * Nesta rodada entram os números REAIS que o painel já tem (quantas
 * subcontas/locations estão vivas e coletando, e o pipeline somado
 * delas) e os cartões "connect" do que depende do Stripe e da API
 * SaaS do HighLevel, que as chaves de location não alcançam. Nenhum
 * número de MRR é inventado.
 */
export default async function AgencyPage() {
  const contas = ACCOUNTS.filter((a) => a.kind !== "potencial");
  const conectaveis = contas.filter((a) => a.sourceStatus === "hl-location");
  const comToken = conectaveis.filter(hasToken);
  const data = await fetchAllV2(contas);
  const pipelineTotal = data.reduce((s, d) => s + d.opportunitiesValue, 0);
  const clients = contas.filter((a) => a.kind === "cliente").length;
  const own = contas.filter((a) => a.kind === "empresa" || a.kind === "projeto").length;
  const community = contas.filter((a) => a.kind === "comunidade").length;

  return (
    <div>
      <h1 style={{ fontSize: 24 }}>Agency <span className="flame">business</span></h1>
      <p className="sub">Your SaaS, in one place. Revenue metrics land when Stripe is wired in (step 5 of the spec); until then, this page shows what is real today and names what is missing.</p>

      <div className="kpis">
        <div className="card" title="Source: panel registry and live HighLevel collection.">
          <div className="label">Locations live</div>
          <div className="value">{data.length}<span style={{ fontSize: 17, color: "#B7A69B" }}> / {conectaveis.length}</span></div>
          <div className="hint">{comToken.length} keys configured · {clients} clients · {own} own brands · {community} community</div>
        </div>
        <div className="card" title="Source: HighLevel opportunities, open, summed across live locations.">
          <div className="label">Open pipeline, all accounts</div>
          <div className="value">{money(pipelineTotal)}</div>
          <div className="hint">client and project pipelines summed</div>
        </div>
        <div className="v2-connect" title="Not connected: Stripe lives outside the panel today.">
          <div className="label">MRR</div>
          <div className="big">CONNECT</div>
          <p>New, expansion, contraction and churn, the Baremetrics cut. Needs Stripe wired into the panel (both live accounts).</p>
        </div>
        <div className="v2-connect" title="Not connected: needs Stripe subscription history.">
          <div className="label">Net revenue retention</div>
          <div className="big">CONNECT</div>
          <p>Comes with the same Stripe connection as MRR.</p>
        </div>
        <div className="v2-connect" title="Not connected: location keys cannot see agency-level logins or activity.">
          <div className="label">Subaccounts at churn risk</div>
          <div className="big">CONNECT</div>
          <p>No login or no activity in 14 days. Needs the HighLevel SaaS/agency level access; location keys cannot see it.</p>
        </div>
        <div className="v2-connect" title="Not connected: needs the aha events defined per product and tracked.">
          <div className="label">Aha moment · first 14 days</div>
          <div className="big">CONNECT</div>
          <p>Subaccounts that reached the activation moment (first automatic reply sent, first booking) in their first 14 days. Needs the events defined and tracked per product.</p>
        </div>
      </div>

      <p className="foot">Step 5 of the 2.0 spec. Nothing on this page is estimated: what is not connected says CONNECT and names the missing piece.</p>
    </div>
  );
}
