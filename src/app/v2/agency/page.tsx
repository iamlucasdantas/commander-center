import { ACCOUNTS, hasToken } from "@/lib/accounts";
import { fetchAllV2 } from "@/lib/v2data";
import { money } from "@/lib/insights";
import { getAnalytics, type StripeAccountSnapshot } from "@/lib/analytics";
import { TZ } from "@/components/viz";

export const dynamic = "force-dynamic";

function moneyIn(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency, maximumFractionDigits: v >= 1000 ? 0 : 2,
    }).format(v);
  } catch {
    return `${currency} ${v.toLocaleString("en-US")}`;
  }
}

function collectedLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ,
  });
}

function StripeAccountCard({ s, collectedAt }: { s: StripeAccountSnapshot; collectedAt: string }) {
  return (
    <div className="card" title={`Source: Stripe subscriptions of ${s.name}, daily collector snapshot. MRR counts active and past-due subscriptions, normalized to a month; trialing is shown separately and stays out of MRR.`}>
      <div className="label">{s.name} · MRR</div>
      <div className="value">{moneyIn(s.mrr, s.currency)}</div>
      <div className="hint">
        {s.activeSubscriptions} active · {s.trialingSubscriptions} trialing · {s.pastDueSubscriptions} past due
      </div>
      <div className="hint">
        +{s.newSubscriptions30d} new in 30d · −{s.canceledSubscriptions30d} canceled in 30d
      </div>
      <div className="hint">snapshot {collectedLabel(collectedAt)} Chicago</div>
    </div>
  );
}

/**
 * Agency business (etapa 5 da spec): a receita do SaaS do Lucas.
 * O que é real entra com número: locations vivas, pipeline somado e,
 * a partir desta etapa, o MRR das duas contas Stripe, gravado todo
 * dia pelo coletor (collect_stripe.py) no snapshot do painel. O que
 * continua sem fonte (NRR, margem de rebilling, churn risk por
 * inatividade, momento aha) entra como "connect" nomeando a fonte
 * que falta. Nenhum número é estimado, e BRL e USD nunca se somam.
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

  const analytics = await getAnalytics();
  const stripe = analytics.stripe;
  const stripeLive = Boolean(stripe && stripe.accounts.length > 0);
  const historyDays = stripe?.history.length ?? 0;

  return (
    <div>
      <h1 style={{ fontSize: 24 }}>Agency <span className="flame">business</span></h1>
      <p className="sub">Your SaaS, in one place. What is real shows a number; what is not connected yet says CONNECT and names the missing source.</p>

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
      </div>

      <h2>SaaS revenue · Stripe</h2>
      {stripeLive ? (
        <>
          <div className="kpis">
            {stripe!.accounts.map((s) => (
              <StripeAccountCard key={s.key} s={s} collectedAt={stripe!.collectedAt} />
            ))}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            The two Stripe accounts bill in different currencies (BRL and USD), so their MRR is shown side by
            side and never summed. MRR counts active and past-due subscriptions, normalized to a month;
            trialing subscriptions are counted separately and stay out of MRR. New and canceled count
            subscriptions created or canceled in the last 30 days. The daily collector also records one MRR
            point per day ({historyDays} day{historyDays === 1 ? "" : "s"} so far): that history is what will
            feed retention and the new / expansion / contraction / churn cut, with nothing backfilled or estimated.
          </p>
        </>
      ) : stripe?.error ? (
        <div className="v2-connect" title="The Stripe collector ran, but the connector did not answer.">
          <div className="label">MRR · Stripe</div>
          <div className="big">CONNECT</div>
          <p>
            The daily Stripe collector ran on {collectedLabel(stripe.collectedAt)} (Chicago) and the Stripe
            connector answered: {stripe.error}. Reconnect Stripe in Muse&apos;s connector settings and the
            next daily run fills in the MRR of both accounts (Magnetic Funnels Brasil and International).
            Nothing is estimated meanwhile.
          </p>
        </div>
      ) : (
        <div className="v2-connect" title="Not connected: no Stripe snapshot has reached the panel yet.">
          <div className="label">MRR · Stripe</div>
          <div className="big">CONNECT</div>
          <p>
            No Stripe snapshot has reached the panel yet. The daily collector (collect_stripe.py) posts the
            first one as soon as the Stripe connection answers: MRR per account, active, trialing and
            past-due subscriptions, new and canceled in 30 days, for Magnetic Funnels Brasil and
            Magnetic Funnels International.
          </p>
        </div>
      )}

      <h2>Still to connect</h2>
      <div className="kpis">
        <div className="v2-connect" title="Not connected: retention needs MRR history over time.">
          <div className="label">Net revenue retention</div>
          <div className="big">CONNECT</div>
          <p>
            Retention is a ratio between two periods of the same customers&apos; revenue. The panel records
            the daily MRR history from the first Stripe snapshot on ({historyDays} day{historyDays === 1 ? "" : "s"} recorded);
            NRR appears when there are two comparable periods of that history, never backfilled or estimated.
          </p>
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
        <div className="v2-connect" title="Not connected: rebilling runs through HighLevel's SaaS billing, which location keys cannot read.">
          <div className="label">Rebilling margin</div>
          <div className="big">CONNECT</div>
          <p>What subaccounts are charged through HighLevel rebilling versus its cost. Needs the HighLevel SaaS/agency billing data; the location keys in this panel cannot see it.</p>
        </div>
      </div>

      <p className="foot">Step 5 of the 2.0 spec. Nothing on this page is estimated: what is not connected says CONNECT and names the missing piece.</p>
    </div>
  );
}
