// Personalização por cliente (ordem do Lucas, 2026-11-22): o painel
// NÃO é igual para todo mundo. Cada conta mostra o bloco de KPIs do
// SERVIÇO CONTRATADO, lido da Central de Clientes no Notion e gravado
// no mapa personalizacao-kpis-plano.md. Onde a fonte não existe hoje,
// o bloco mostra a PENDÊNCIA exata (qual escopo, qual endpoint), nunca
// um número inventado.
//
// As pendências abaixo foram medidas ao vivo em 2026-11-22 com uma
// sonda nas próprias locations:
//   - mensagens das conversas: HTTP 401 com os escopos atuais da
//     chave (sem duração de ligação nem separação IA x humano);
//   - reputação (avaliações): endpoints candidatos respondem 404/401;
//   - funis do HighLevel: 401 (falta escopo de funis);
//   - definições de campos customizados: 401 (falta escopo), o que
//     impede o corte por urgência/serviço no QC Electric.

export interface ServiceConfig {
  /** Título do bloco, ex.: "Voice AI & leads". */
  title: string;
  /** KPI principal contratado, como está no Notion. */
  kpiLabel: string;
  /** Mostra o bloco de ligações (conversas TYPE_CALL da janela). */
  showCalls?: boolean;
  /** Nome do agente de voz, quando existe. */
  callAgent?: string;
  /** Pipeline cuja distribuição de etapas abertas É o KPI. */
  stagesPipeline?: string;
  /** Mostra ganhos/perdas (aluguéis fechados da Globalaser). */
  showWon?: boolean;
  /** KPI = agendamentos: o painel lê os calendários do HighLevel ao
      vivo (lista + eventos 30d) e a etapa Booked mostra o número real. */
  showAppointments?: boolean;
  /** KPI = pedidos vindos de formulário do site (Blue Steel). */
  formKpi?: boolean;
  /** Contexto curto, exibido no bloco. */
  note?: string;
  /** O que ainda não dá para medir, com a causa exata. */
  pendencies: string[];
  /** Motivo exato da etapa Booked do funil quando os agendamentos
      NÃO vivem no HighLevel desta conta (sobrepõe o texto padrão de
      "CONNECT por falta de escopo de calendários"). */
  bookedNote?: string;
  /** Motivo exato no card "Speed to lead" quando difere do padrão. */
  speedToLeadNote?: string;
  /** Motivo exato no card "Missed calls" quando difere do padrão. */
  missedCallsNote?: string;
}

const PEND_MESSAGES =
  "Call duration and the AI vs human split are not measurable yet: the conversation messages endpoint answers 401 with this key's current scopes (messages scope missing).";
const PEND_CALENDARS =
  "Appointments are not verified yet for this account: where this client's bookings live has not been checked, so no booked number is shown instead of a guessed one.";
const PEND_CAMPAIGNS =
  "Email campaigns are not measurable yet: the key has no campaigns scope.";
const PEND_REPUTATION =
  "Google reviews are not measurable yet: HighLevel exposes no review data to this key (reputation endpoints answer 404/401 with the current scopes). The review work runs inside HighLevel; the panel shows the pendency instead of an invented number.";
const PEND_STRIPE =
  "MRR is not in the panel yet: Stripe is connected outside the panel; bringing subscriptions and MRR in is a registered next step.";

export const SERVICE_CONFIG: Record<string, ServiceConfig> = {
  // Pendências da The Bar RE-MEDIDAS ao vivo em 2026-11-26, já com a
  // chave unificada "Commander Center" (todos os escopos): o quadro
  // mudou em relação à sonda de 2026-11-22. Calendários e campanhas
  // agora respondem; mensagens seguem 401, mas por HIPAA, não por
  // escopo. Agendamentos reais não vivem no HighLevel (Aesthetic
  // Record) e o módulo Campaigns está vazio nesta location.
  "the-bar-aesthetics": {
    title: "Voice AI & leads",
    kpiLabel: "Main KPI: new leads",
    showCalls: true,
    callAgent: "Chloe, the Voice AI agent",
    note: "Full service: HighLevel, WordPress site, Voice AI, Meta Ads, SEO, blog and email. Phone is a top lead source here (source \"Call\" leads the recent contacts).",
    pendencies: [
      "Call duration and the AI vs human split are not measurable: this location is a HIPAA-compliant account, and HighLevel blocks the conversation messages API for it (401 \"Can not fetch messages from HIPAA compliant account\"), whatever scopes the key has. Speed to lead and per-call detail sit behind the same wall.",
      "Booked appointments are not in HighLevel for this client: bookings happen in Aesthetic Record. The calendars scope works now, but in the last 12 months the HighLevel calendars hold only 12 test events (May–Jun 2026) and Chloe's calendar holds none, so the panel shows no booked number instead of a misleading one.",
      "Email campaigns have no number to show: the campaigns endpoint answers now, but this location has zero campaigns in the module (0 draft, 0 published), so there is no campaign metric to display.",
    ],
    bookedNote:
      "Not booked in HighLevel: this client books in Aesthetic Record. The HighLevel calendars answer now, but hold only test events (12 in 12 months, no real client bookings), so nothing is shown instead of a misleading number.",
    speedToLeadNote:
      "Not measurable on this account: the messages API is blocked for HIPAA-compliant locations (401), so the first-reply time cannot be computed, whatever scopes the key has.",
    missedCallsNote:
      "Call conversations are counted in the Voice AI block. Which of them were missed needs the per-call detail behind the messages API, which HighLevel blocks for HIPAA-compliant locations (401).",
  },
  "corazon-latino": {
    title: "Reputation management",
    kpiLabel: "Main KPI: new Google reviews",
    note: "The contracted work is Google presence and reputation: automatic review replies inside HighLevel (agents \"Corazon Latino Review Replies\" and \"Negative Reviews\"). Reviews are measured by the panel's Google Business Profile collector (daily snapshots), not by the HighLevel key. Measured live on 2026-11-27: 224 reviews, 4.7 stars, 160 without a reply, 64 replies in the last 30 days with an average reply time of 25.2 days, and 9 new reviews in 30 days (down 36% on the previous period). The older Notion note (backlog of 222 being cleared at about 10 per day) no longer matches the measured pace.",
    bookedNote:
      "Not tracked in HighLevel: this client's contracted service is reputation management (Google reviews), and reservations are not recorded in the HighLevel calendars (the calendars here are service listings, 4 of 5 inactive, and the active one holds no events in the last 180 days), so no booked number is shown.",
    speedToLeadNote:
      "Not computed yet: the messages API answers for this account (verified live on 2026-11-27), so first-response time can be measured; the panel does not compute it yet.",
    missedCallsNote:
      "Not computed yet: the per-call detail sits behind the messages API, which answers for this account (verified live on 2026-11-27); the panel does not compute missed calls yet.",
    pendencies: [],
  },
  "sumthin-different": {
    title: "Appointments",
    kpiLabel: "Main KPI: appointments booked",
    note: "Verified live on 2026-11-27 with the unified Commander Center key: the calendars scope answers and the location holds 6 active calendars, but they hold only 1 test event in 12 months. The shop's real bookings run in its external system (the myCRMSIM connection) and the appointment reminders flow through HighLevel conversations from there. Site traffic is in the Website block below (GA4 + Search Console).",
    bookedNote:
      "Not booked in HighLevel: this shop books in its external booking system (the myCRMSIM connection); appointment reminders reach clients through HighLevel conversations from there. The HighLevel calendars answer with the unified key, but hold only 1 test event in 12 months across 6 active calendars, so nothing is shown instead of a misleading zero.",
    speedToLeadNote:
      "Not computed yet: the messages API answers for this account (verified live on 2026-11-27), so first-response time can be measured; the panel does not compute it yet.",
    missedCallsNote:
      "Not computed yet: the per-call detail sits behind the messages API, which answers for this account (verified live on 2026-11-27); the panel does not compute missed calls yet.",
    pendencies: [],
  },
  "pee-wees-soul-food": {
    title: "Google reviews",
    kpiLabel: "Main KPI: new Google reviews (goal: 5 per month)",
    note: "Google Business posts run 3x per week through the Social Planner inside HighLevel.",
    pendencies: [PEND_REPUTATION],
  },
  globalaser: {
    title: "Equipment rentals",
    kpiLabel: "Main KPI: closed rentals (won opportunities)",
    showWon: true,
    stagesPipeline: "ALUGUER",
    note: "The ALUGUER pipeline stages ARE the lead score bands: Prata (up to 50), Ouro (51 to 89), Diamante (90 to 100), then contact attempts, meeting and Handoff.",
    pendencies: [],
  },
  "dr-josiel-peixoto": {
    title: "Appointments",
    kpiLabel: "Main KPI: appointments booked",
    showCalls: true,
    callAgent: "Maria Luz, the AI agent",
    stagesPipeline: "Gestão de Clientes",
    note: "The stage counts below are the panel's proxy for bookings (Agendado, Compareceu) until the calendars scope lands. Intake here is mostly Instagram and WhatsApp, so the recent window may show few or no phone calls.",
    pendencies: [PEND_CALENDARS, PEND_MESSAGES],
  },
  "blue-steel-auto-body": {
    title: "Quote requests",
    kpiLabel: "Main KPI: quote requests from the website form",
    formKpi: true,
    note: "Traffic behind those requests is in the Website block below (GA4 + Search Console).",
    pendencies: [],
  },
  "simpson-ltd": {
    title: "Website first, 90 days",
    kpiLabel: "Main KPI: website sessions (GA4), then sales",
    note: "The GA4 property on file for Simpson comes from a Firebase project; if the Website block says \"connected, no data\", the property is not receiving the site's traffic yet.",
    pendencies: [PEND_REPUTATION],
  },
  "the-gypsy-highway": {
    title: "Website traffic",
    kpiLabel: "Main KPI: website sessions (GA4)",
    note: "The client's Facebook Page (GypsyHighway) is tracked on the Social page. Secondary KPIs in Notion: social reach, Google reviews and the newsletter list.",
    pendencies: [PEND_REPUTATION],
  },
  "mi-rancho": {
    title: "Website + Google",
    kpiLabel: "Main KPI: Google reviews",
    note: "Contract defined by Lucas on 2026-11-22: website plus Google presence. No HighLevel services and no social media in scope.",
    pendencies: [PEND_REPUTATION],
  },
  "magnetic-funnels-us": {
    title: "SaaS",
    kpiLabel: "Main KPI: MRR (Stripe)",
    showCalls: true,
    note: "Demo and sales lines ring in this location, so the calls block below is the demo-line activity in the recent window.",
    pendencies: [PEND_STRIPE, PEND_MESSAGES],
  },
  "comunidade-magnetic-flows": {
    title: "SaaS community (Brazil)",
    kpiLabel: "Main KPI: MRR (Stripe)",
    note: "The support queue for this community is the waiting list below: keeping it answered protects the recurring base.",
    pendencies: [PEND_STRIPE],
  },
  "magnetic-flows-community": {
    title: "Quad Cities Digital",
    kpiLabel: "Main KPI: website traffic of quadcitiesdigital.com",
    note: "This HighLevel location is the old Magnetic Flows Community (SMS for QC House Cleaning). The Quad Cities Digital project's own traffic is the Website block below.",
    pendencies: [],
  },
  "food-truck-qc": {
    title: "Food truck owners",
    kpiLabel: "Main KPI: registered trucks (in the FoodTruckQC app)",
    note: "Owners and leads live in this HighLevel location; the site's traffic is the Website block below.",
    pendencies: [
      "Registered trucks are counted in the FoodTruckQC app itself; that data source is not wired into the panel yet.",
    ],
  },
  "qc-aesthetics": {
    title: "Lead generation",
    kpiLabel: "Main KPI: new leads",
    showCalls: true,
    pendencies: [PEND_CALENDARS, PEND_REPUTATION, PEND_MESSAGES],
  },
  "qc-home-renovation": {
    title: "Lead generation",
    kpiLabel: "Main KPI: generated leads",
    note: "Three sites feed this operation (Quad Cities Home Renovation, Bettendorf Remodeling, Davenport Siding); the Website block sums all three.",
    pendencies: [],
  },
  "qc-house-cleaning": {
    title: "Lead generation",
    kpiLabel: "Main KPI: generated leads",
    showCalls: true,
    note: "Phone is the dominant intake here: most of the recent conversation window is calls.",
    pendencies: [PEND_CALENDARS, PEND_MESSAGES],
  },
  "qc-electric": {
    title: "Lead generation, Electric + HVAC",
    kpiLabel: "Main KPI: generated leads",
    note: "Origin split available today: form vs chat vs other sources, in the lead mix on the overview and in this week's lead list.",
    pendencies: [
      "The Electric vs HVAC split and the urgency field are not measurable yet: the custom field definitions endpoint answers 401 with this key's current scopes.",
      PEND_REPUTATION,
    ],
  },
  "qc-landscaping": {
    title: "Lead generation, Landscaping + Tree Service (QC)",
    kpiLabel: "Main KPI: generated leads",
    note: "Google positions for the three sites are in the Website block (Search Console average position). Review goal in Notion: 100+ Google reviews.",
    pendencies: [PEND_REPUTATION],
  },
  "clientes-nos-eua": {
    title: "Lead generation + AI receptionists",
    kpiLabel: "Main KPI: new leads",
    showCalls: true,
    note: "The AI receptionists (Riley, Jamie) answer inside each end client's own subaccount, so their calls do not land in this location; this block shows this location's own call activity.",
    pendencies: [PEND_MESSAGES],
  },
  "muscatine-tree-service": {
    title: "Lead generation (own operation)",
    kpiLabel: "Main KPI: generated leads",
    note: "Separate operation from the Quad Cities tree service, with its own subaccount (definition by Lucas, 2026-11-22).",
    pendencies: [],
  },
};
