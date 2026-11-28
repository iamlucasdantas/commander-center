import { NextResponse } from "next/server";
import { ACCOUNTS, notConnectedReason } from "@/lib/accounts";
import { getPitToken, hasResolvedToken } from "@/lib/pit";
import { SERVICE_CONFIG } from "@/lib/services";
import { effectivePriority, getState, makeLogEntry, makeTask, mutateState, stateConfigured, type PanelTask } from "@/lib/state";
import { getAnalytics, ingestAnalytics } from "@/lib/analytics";
import { fetchV2Account } from "@/lib/v2data";
import { accountHealthV2, diagnosisFor, doNextFor } from "@/lib/v2insights";
import { hlLink } from "@/lib/v2data";
import { reputationLine } from "@/lib/reputation";

// Porta dos agentes do OpenBot (pedido do Lucas, 2026-11-25): o
// Commander Center passa a ser a central principal de tarefas e os
// agentes precisam ler o painel e gravar nele SEM nenhuma chave em
// instrução ou arquivo. O OpenBot guarda cabeçalhos de um MCP custom
// como segredo, então este endpoint fala o protocolo MCP (Streamable
// HTTP, JSON-RPC 2.0, respostas em JSON) e exige dois cabeçalhos:
//   - x-vercel-protection-bypass: passa pelo SSO do Vercel;
//   - x-panel-key: igual à env PANEL_API_KEY (sem a env, 503: a
//     porta nunca fica aberta por engano).
// Nada aqui escreve no HighLevel. As ferramentas gravam no mesmo
// armazenamento do painel (state.ts / analytics.ts), com `by` = nome
// do agente, para o Lucas ver no log quem mexeu.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROTOCOL = "2025-03-26";

type Json = Record<string, unknown>;

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Json;
}

const TOOLS: ToolDef[] = [
  {
    name: "panel_status",
    description: "List every account of the Commander Center with slug, name, kind, contracted service, main KPI, connection status and Google reviews line when collected. Use the slug in every other tool.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "account_summary",
    description: "Live summary of one account: health (Act now / Watch / Flowing), diagnosis, leads today/7d/30d, waiting conversations, open pipeline, won 30d, suggested next actions and Google reviews when collected. Reads HighLevel live (5-minute cache).",
    inputSchema: { type: "object", properties: { slug: { type: "string", description: "Account slug from panel_status" } }, required: ["slug"], additionalProperties: false },
  },
  {
    name: "list_contacts",
    description: "Read contacts of one account's HighLevel subaccount, most recent first: id, name, phone, email, tags, source, dateAdded, plus the subaccount total. Read-only. Optional query searches name, email or phone.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Account slug from panel_status" },
        limit: { type: "number", description: "How many contacts, 1 to 50, default 20" },
        query: { type: "string", description: "Optional search text" },
      },
      required: ["slug"],
      additionalProperties: false,
    },
  },
  {
    name: "list_conversations",
    description: "Read the most recent conversations of one account's HighLevel subaccount: id, contact, unreadCount, last message date, direction, type and a short preview. A conversation whose last message is inbound and unread is waiting for a reply. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Account slug from panel_status" },
        limit: { type: "number", description: "How many conversations, 1 to 50, default 20" },
      },
      required: ["slug"],
      additionalProperties: false,
    },
  },
  {
    name: "conversation_messages",
    description: "Read the messages of one conversation of an account's HighLevel subaccount, most recent first: direction, type, date and body (truncated). Read-only. Get conversation_id from list_conversations.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Account slug from panel_status" },
        conversation_id: { type: "string", description: "Conversation id from list_conversations" },
        limit: { type: "number", description: "How many messages, 1 to 50, default 20" },
      },
      required: ["slug", "conversation_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_custom_values",
    description: "Read the custom values of one account's HighLevel subaccount (site, social links, group links, per-match fields). Credential-looking values (keys, tokens, integrations) are listed by name with the value hidden. Read-only.",
    inputSchema: { type: "object", properties: { slug: { type: "string", description: "Account slug from panel_status" } }, required: ["slug"], additionalProperties: false },
  },
  {
    name: "list_trigger_links",
    description: "Read the trigger links of one account's HighLevel subaccount: name and the URL each one redirects to (group invites, social links, interview links). Read-only.",
    inputSchema: { type: "object", properties: { slug: { type: "string", description: "Account slug from panel_status" } }, required: ["slug"], additionalProperties: false },
  },
  {
    name: "send_message",
    description: "SEND a message in an account's HighLevel subaccount. This is THE way to message a person. Two modes: (1) REPLY: pass conversation_id from list_conversations (read it first with conversation_messages); the contact is resolved on the server. (2) FIRST MESSAGE to a contact with no conversation yet: omit conversation_id and pass contact_id from list_contacts (search by phone or name); a new conversation is created. type must match the channel: SMS for WhatsApp (Wazzy) and SMS, IG for Instagram DM and Instagram comments, FB for Facebook Messenger and Facebook comments, Email for email (subject required), Live_Chat for live chat. The message goes out on the subaccount's own channel. Returns the HighLevel message id as proof.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Account slug from panel_status" },
        conversation_id: { type: "string", description: "Conversation id from list_conversations, for a REPLY inside an existing conversation. Omit it to send a FIRST message to a contact: a new conversation is created, and contact_id is then required." },
        contact_id: { type: "string", description: "Contact id from list_contacts (search by phone or name). Required when conversation_id is omitted (first message). In reply mode it is normally omitted: the tool resolves the conversation's contact on the server." },
        type: { type: "string", enum: ["SMS", "IG", "FB", "Email", "Live_Chat"], description: "Channel type. SMS sends through the account's WhatsApp provider (Wazzy) in this subaccount." },
        message: { type: "string", description: "The message text" },
        subject: { type: "string", description: "Email subject, required when type is Email" },
        html: { type: "string", description: "Optional email HTML body when type is Email" },
      },
      required: ["slug", "type", "message"],
      additionalProperties: false,
    },
  },
  {
    name: "hl_request",
    description: "Call ANY endpoint of the account's HighLevel API: the whole API, not a fixed list. This is the general-purpose door for everything the specific tools do not cover (social planner posts, workflows, opportunities, calendars, forms, orders, any endpoint from the official docs). You never need any key: the server resolves the subaccount token. Pass the API path exactly as documented, including the location id where the endpoint requires it (get it from account_summary or panel_status). Returns the HighLevel HTTP status and the response body verbatim, errors included. Examples: GET /social-media-posting/<locationId>/accounts; POST /social-media-posting/<locationId>/posts/list with body {\"type\":\"all\"}; GET /opportunities/search?location_id=<locationId>.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Account slug from panel_status" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "HTTP method of the API endpoint" },
        path: { type: "string", description: "API path starting with /, exactly as documented, query string included when needed" },
        body: { type: "object", description: "Optional JSON body for POST, PUT and PATCH endpoints", additionalProperties: true },
      },
      required: ["slug", "method", "path"],
      additionalProperties: false,
    },
  },
  {
    name: "update_custom_value",
    description: "Update one custom value of an account's HighLevel subaccount (for example the next-match fields: opponent, match links, email subject). Get custom_value_id and the current name from list_custom_values; the name must be sent back unchanged. Credential-looking values cannot be changed here.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Account slug from panel_status" },
        custom_value_id: { type: "string", description: "Custom value id from list_custom_values" },
        name: { type: "string", description: "The custom value name, unchanged" },
        value: { type: "string", description: "The new value" },
      },
      required: ["slug", "custom_value_id", "name", "value"],
      additionalProperties: false,
    },
  },
  {
    name: "list_tasks",
    description: "List the panel's tasks (Lucas's pendencies, P1/P2/P3). Open ones first. Optional filter by project slug and status.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Account slug to filter, optional" },
        status: { type: "string", enum: ["open", "done", "all"], description: "Default open" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_task",
    description: "Create a task in the panel. Search list_tasks first and never duplicate an open task with the same meaning. Support tickets without a definitive solution are forced to P3 by the server.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title, verb first, max 300 chars" },
        priority: { type: "integer", enum: [1, 2, 3], description: "1 = do now, 2 = this week, 3 = later. Default 2" },
        project: { type: "string", description: "Account slug (from panel_status)" },
        note: { type: "string", description: "Context, deadline, who asked, max 2000 chars" },
        supportTicket: { type: "boolean" },
        definitiveSolution: { type: "boolean" },
        by: { type: "string", description: "Your agent name, e.g. Account Manager. Required." },
      },
      required: ["title", "by"],
      additionalProperties: false,
    },
  },
  {
    name: "update_task",
    description: "Change a task: action toggle (done <-> open), priority, or update (title, note, project, priority).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        action: { type: "string", enum: ["toggle", "priority", "update"] },
        priority: { type: "integer", enum: [1, 2, 3] },
        title: { type: "string" },
        note: { type: "string" },
        project: { type: "string" },
        by: { type: "string", description: "Your agent name. Required." },
      },
      required: ["id", "action", "by"],
      additionalProperties: false,
    },
  },
  {
    name: "add_log",
    description: "Write an entry in the account's log in the panel (what you did or found for that client). kind log = something done; kind task = a pending item for Lucas on that account.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Account slug" },
        title: { type: "string", description: "Max 300 chars" },
        kind: { type: "string", enum: ["log", "task"], description: "Default log" },
        status: { type: "string", enum: ["pending", "completed"], description: "Default completed" },
        detail: { type: "string", description: "Max 4000 chars" },
        by: { type: "string", description: "Your agent name. Required." },
      },
      required: ["slug", "title", "by"],
      additionalProperties: false,
    },
  },
  {
    name: "list_log",
    description: "Read the panel log, newest first. Optional account slug filter and limit (default 30).",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200 } },
      additionalProperties: false,
    },
  },
  {
    name: "ingest_reputation",
    description: "Save today's Google Business Profile snapshot for one account (the reputation collector calls this once a day per account). Numbers must come from the Google Business Profile API, never estimated.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Account slug" },
        snapshot: {
          type: "object",
          description: "ReputationSnapshot: collectedAt (ISO), gbpLocation (accounts/../locations/..), title, totalReviews, averageRating, new30, newPrev30, replied, unreplied, repliedLast30, avgReplyHours, negativeUnreplied [{name, rating, when, excerpt, url}], calls30, websiteClicks30, directions30, error",
        },
      },
      required: ["slug", "snapshot"],
      additionalProperties: false,
    },
  },
];

function authorized(req: Request): "ok" | "unset" | "bad" {
  const key = process.env.PANEL_API_KEY;
  if (!key) return "unset";
  return req.headers.get("x-panel-key") === key ? "ok" : "bad";
}

function rpcError(id: unknown, code: number, message: string, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

function rpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function text(obj: unknown) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function clampNum(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.min(max, Math.max(min, n));
}

const HL_BASE = "https://services.leadconnectorhq.com";

async function hlAgentGet(path: string, pit: string): Promise<unknown> {
  const res = await fetch(`${HL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${pit}`, Version: "2021-07-28", Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HighLevel ${res.status}`);
  return res.json();
}

/**
 * Generic HighLevel call for hl_request: returns the API status and body
 * verbatim (errors included) so the agent sees exactly what the API said.
 * This is the bridge's power behind the panel door: the agent never
 * handles any key, the server resolves the subaccount token as always.
 */
async function hlAgentCall(
  method: string,
  path: string,
  pit: string,
  body: unknown,
): Promise<{ status: number; data: unknown }> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${pit}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  };
  if (body !== undefined && method !== "GET" && method !== "DELETE") {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${HL_BASE}${path}`, init);
  const raw = await res.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { raw: raw.slice(0, 1000) };
  }
  return { status: res.status, data };
}

async function hlAgentWrite(method: "POST" | "PUT", path: string, pit: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${HL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${pit}`,
      Version: "2021-07-28",
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const raw = await res.text();
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = { raw: raw.slice(0, 300) };
  }
  if (!res.ok) {
    throw new Error(`HighLevel ${res.status}: ${typeof parsed === "object" && parsed ? JSON.stringify(parsed).slice(0, 300) : raw.slice(0, 300)}`);
  }
  return parsed;
}

/** Gate das ferramentas de leitura do CRM: conta conectada e token resolvido (Supabase ou env). */
async function gateAccount(slug: string): Promise<{ a: (typeof ACCOUNTS)[number]; pit: string } | { error: unknown }> {
  const a = ACCOUNTS.find((x) => x.slug === slug);
  if (!a) return { error: { error: "Unknown account slug" } };
  if (a.sourceStatus !== "hl-location" || !a.locationId) {
    return { error: { slug, name: a.name, status: notConnectedReason(a) } };
  }
  const pit = await getPitToken(a);
  if (!pit) return { error: { slug, name: a.name, status: notConnectedReason(a) } };
  return { a, pit };
}

async function callTool(name: string, args: Json): Promise<unknown> {
  switch (name) {
    case "panel_status": {
      const analytics = await getAnalytics();
      return Promise.all(
        ACCOUNTS.map(async (a) => {
          const cfg = SERVICE_CONFIG[a.slug];
          const rep = analytics.reputation?.[a.slug];
          const connected = a.sourceStatus === "hl-location" && (await hasResolvedToken(a));
          return {
            slug: a.slug,
            name: a.name,
            kind: a.kind,
            service: cfg?.title ?? null,
            mainKpi: cfg?.kpiLabel ?? null,
            connected,
            status: connected ? "connected" : notConnectedReason(a),
            site: a.site,
            googleReviews: rep ? reputationLine(rep) : null,
            pendencies: cfg?.pendencies ?? [],
          };
        }),
      );
    }
    case "account_summary": {
      const slug = str(args.slug, 80) ?? "";
      const a = ACCOUNTS.find((x) => x.slug === slug);
      if (!a) return { error: "Unknown account slug" };
      const analytics = await getAnalytics();
      const snap = analytics.sites[slug];
      const rep = analytics.reputation?.[slug];
      if (a.sourceStatus !== "hl-location" || !(await hasResolvedToken(a))) {
        return { slug, name: a.name, status: notConnectedReason(a), googleReviews: rep ?? null, website: snap ?? null };
      }
      const d = await fetchV2Account(a);
      if (!d) return { slug, name: a.name, status: "collection failed just now", googleReviews: rep ?? null };
      const h = accountHealthV2(d);
      const next = doNextFor(a, d, (area) => hlLink(a.locationId, area), snap?.gsc ?? null);
      return {
        slug,
        name: a.name,
        service: SERVICE_CONFIG[slug]?.title ?? null,
        mainKpi: SERVICE_CONFIG[slug]?.kpiLabel ?? null,
        health: { level: h.level, label: h.label, reason: h.reason },
        diagnosis: diagnosisFor(d, snap?.gsc ?? null),
        verifiedContacts: { today: d.contactsTodayV, yesterday: d.contactsYesterdayV, last7d: d.contacts7dV, prev7d: d.contactsPrev7dV, last30d: d.contacts30dV, prev30d: d.contactsPrev30dV, fakeQuarantined30d: d.fakeCount30d },
        waiting: { count: d.waitingCount, oldestMinutes: d.waitingOldestMin, items: d.waiting.slice(0, 10) },
        pipeline: { open: d.opportunitiesOpen, openValue: d.opportunitiesValue, idleCount: d.idleCount, idleValue: d.idleValue, won30Count: d.won30Count, won30Value: d.won30Value },
        doNext: next,
        website: snap ? { collectedAt: snap.collectedAt, ga4: snap.ga4 ? { sessions28: snap.ga4.sessions28, sessionsPrev28: snap.ga4.sessionsPrev28, users28: snap.ga4.users28 } : null, gsc: snap.gsc ? { clicks28: snap.gsc.clicks28, impressions28: snap.gsc.impressions28, position28: snap.gsc.position28, topQueries: snap.gsc.topQueries.slice(0, 10) } : null } : null,
        googleReviews: rep ?? null,
        pendencies: SERVICE_CONFIG[slug]?.pendencies ?? [],
        fetchedAt: new Date(d.fetchedAt).toISOString(),
      };
    }
    case "list_contacts": {
      const g = await gateAccount(str(args.slug, 80) ?? "");
      if ("error" in g) return g.error;
      const limit = clampNum(args.limit, 20, 1, 50);
      const query = str(args.query, 120);
      const path =
        `/contacts/?locationId=${g.a.locationId}&limit=${limit}` +
        (query ? `&query=${encodeURIComponent(query)}` : "");
      const res = (await hlAgentGet(path, g.pit)) as {
        contacts?: Record<string, unknown>[];
        meta?: { total?: number };
      };
      return {
        slug: g.a.slug,
        name: g.a.name,
        total: res.meta?.total ?? null,
        contacts: (res.contacts ?? []).map((c) => ({
          id: c.id ?? null,
          name: c.contactName ?? ([c.firstName, c.lastName].filter(Boolean).join(" ") || null),
          phone: c.phone ?? null,
          email: c.email ?? null,
          tags: c.tags ?? [],
          source: c.source ?? null,
          dateAdded: c.dateAdded ?? null,
        })),
      };
    }
    case "list_conversations": {
      const g = await gateAccount(str(args.slug, 80) ?? "");
      if ("error" in g) return g.error;
      const limit = clampNum(args.limit, 20, 1, 50);
      const res = (await hlAgentGet(`/conversations/search?locationId=${g.a.locationId}&limit=${limit}`, g.pit)) as {
        conversations?: Record<string, unknown>[];
        total?: number;
      };
      return {
        slug: g.a.slug,
        name: g.a.name,
        total: res.total ?? null,
        conversations: (res.conversations ?? []).map((cv) => ({
          id: cv.id ?? null,
          contactId: cv.contactId ?? null,
          contactName: cv.contactName ?? null,
          contactPhone: cv.phone ?? null,
          type: cv.type ?? null,
          unreadCount: cv.unreadCount ?? 0,
          lastMessageDate: cv.lastMessageDate ?? null,
          lastMessageDirection: cv.lastMessageDirection ?? null,
          lastMessageType: cv.lastMessageType ?? null,
          lastMessageBody: typeof cv.lastMessageBody === "string" ? cv.lastMessageBody.slice(0, 200) : null,
        })),
      };
    }
    case "conversation_messages": {
      const g = await gateAccount(str(args.slug, 80) ?? "");
      if ("error" in g) return g.error;
      const conversationId = str(args.conversation_id, 80) ?? "";
      if (!conversationId) return { error: "conversation_id is required" };
      const limit = clampNum(args.limit, 20, 1, 50);
      const res = (await hlAgentGet(`/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`, g.pit)) as {
        messages?: Record<string, unknown>[] | { messages?: Record<string, unknown>[] };
      };
      const raw = res.messages;
      const arr = Array.isArray(raw) ? raw : (raw?.messages ?? []);
      return {
        slug: g.a.slug,
        conversationId,
        messages: arr.map((m) => ({
          id: m.id ?? null,
          direction: m.direction ?? null,
          type: m.type ?? null,
          status: m.status ?? null,
          dateAdded: m.dateAdded ?? null,
          contactId: m.contactId ?? null,
          body: typeof m.body === "string" ? m.body.slice(0, 500) : null,
        })),
      };
    }
    case "list_custom_values": {
      const g = await gateAccount(str(args.slug, 80) ?? "");
      if ("error" in g) return g.error;
      const res = (await hlAgentGet(`/locations/${g.a.locationId}/customValues`, g.pit)) as {
        customValues?: Record<string, unknown>[];
      };
      const secretName = /(key|token|secret|private|integration|password|senha)/i;
      return {
        slug: g.a.slug,
        name: g.a.name,
        customValues: (res.customValues ?? []).map((cv) => {
          const nm = typeof cv.name === "string" ? cv.name : "";
          const hidden = secretName.test(nm);
          return {
            id: cv.id ?? null,
            name: nm,
            value: hidden ? null : (cv.value ?? null),
            hidden: hidden || undefined,
          };
        }),
      };
    }
    case "list_trigger_links": {
      const g = await gateAccount(str(args.slug, 80) ?? "");
      if ("error" in g) return g.error;
      const res = (await hlAgentGet(`/links/?locationId=${g.a.locationId}`, g.pit)) as {
        links?: Record<string, unknown>[];
      };
      return {
        slug: g.a.slug,
        name: g.a.name,
        links: (res.links ?? [])
          .filter((l) => !l.deleted)
          .map((l) => ({
            id: l.id ?? null,
            name: l.name ?? null,
            redirectTo: l.redirectTo ?? null,
            fieldKey: l.fieldKey ?? null,
          })),
      };
    }
    case "send_message": {
      const g = await gateAccount(str(args.slug, 80) ?? "");
      if ("error" in g) return g.error;
      const conversationId = str(args.conversation_id, 80) ?? "";
      const type = str(args.type, 20) ?? "";
      if (!["SMS", "IG", "FB", "Email", "Live_Chat"].includes(type)) {
        return { error: "type must be one of SMS, IG, FB, Email, Live_Chat" };
      }
      const message = str(args.message, 4000) ?? "";
      if (!message) return { error: "message is required" };
      const subject = str(args.subject, 300);
      if (type === "Email" && !subject) return { error: "subject is required for Email" };
      const html = str(args.html, 20000);
      // The HighLevel send endpoint requires contactId ("Contact id not given" 404 without it).
      // Reply mode (conversation_id given): resolve the contact server-side from the conversation;
      // an explicit contact_id argument wins when provided.
      // First-message mode (no conversation_id): contact_id is required and HighLevel creates
      // a new conversation for that contact.
      let contactId = str(args.contact_id, 80) ?? "";
      if (!contactId && conversationId) {
        const conv = (await hlAgentGet(`/conversations/${encodeURIComponent(conversationId)}`, g.pit)) as {
          conversation?: { contactId?: string };
          contactId?: string;
        } | null;
        contactId = conv?.conversation?.contactId ?? conv?.contactId ?? "";
      }
      if (!contactId) {
        return {
          error: conversationId
            ? "could not resolve the contact of this conversation; pass contact_id"
            : "contact_id is required to send a first message (find the contact with list_contacts, searching by phone or name)",
        };
      }
      const payload: Record<string, unknown> = { type, contactId, message };
      if (conversationId) payload.conversationId = conversationId;
      if (subject) payload.subject = subject;
      if (html) payload.html = html;
      const res = (await hlAgentWrite("POST", "/conversations/messages", g.pit, payload)) as Record<string, unknown> | null;
      return {
        slug: g.a.slug,
        conversationId: conversationId || null,
        type,
        sent: true,
        messageId: res?.messageId ?? res?.id ?? null,
        conversationIdReturned: res?.conversationId ?? null,
      };
    }
    case "hl_request": {
      const g = await gateAccount(str(args.slug, 80) ?? "");
      if ("error" in g) return g.error;
      const method = (str(args.method, 10) ?? "").toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        return { error: "method must be one of GET, POST, PUT, PATCH, DELETE" };
      }
      const path = typeof args.path === "string" ? args.path : "";
      if (
        path.length < 2 ||
        path.length > 2000 ||
        !path.startsWith("/") ||
        path.startsWith("//") ||
        path.includes("..") ||
        path.includes("\\") ||
        /[\s\x00-\x1f]/.test(path)
      ) {
        return { error: "path must be an API path starting with / (no spaces, no ..)" };
      }
      const body = args.body !== undefined ? args.body : undefined;
      const { status, data } = await hlAgentCall(method, path, g.pit, body);
      let serialized = "";
      try {
        serialized = JSON.stringify(data) ?? "";
      } catch {
        serialized = "";
      }
      if (serialized.length > 9000) {
        return {
          slug: g.a.slug,
          status,
          truncated: true,
          note: "Response was larger than 9000 characters and was cut. Narrow the call (limit, page, filters) to see the rest.",
          dataPreview: serialized.slice(0, 9000),
        };
      }
      return { slug: g.a.slug, status, data };
    }
    case "update_custom_value": {
      const g = await gateAccount(str(args.slug, 80) ?? "");
      if ("error" in g) return g.error;
      const cvId = str(args.custom_value_id, 80) ?? "";
      const name = str(args.name, 200) ?? "";
      const value = typeof args.value === "string" ? args.value.slice(0, 2000) : "";
      if (!cvId || !name) return { error: "custom_value_id and name are required" };
      if (/(key|token|secret|private|integration|password|senha)/i.test(name)) {
        return { error: "Credential-looking custom values cannot be changed through this tool" };
      }
      const res = (await hlAgentWrite("PUT", `/locations/${g.a.locationId}/customValues/${encodeURIComponent(cvId)}`, g.pit, { name, value })) as Record<string, unknown> | null;
      return { slug: g.a.slug, customValueId: cvId, name, updated: true, value: res && "value" in res ? res.value : value };
    }
    case "list_tasks": {
      if (!stateConfigured()) return { configured: false, tasks: [] };
      const s = await getState(0);
      const project = str(args.project, 120);
      const status = str(args.status, 10) ?? "open";
      const tasks = s.tasks
        .filter((t) => (status === "all" ? true : t.status === status))
        .filter((t) => (project ? t.project === project : true));
      const open = tasks.filter((t) => t.status === "open").sort((a, b) => effectivePriority(a) - effectivePriority(b) || (a.createdAt < b.createdAt ? -1 : 1));
      const done = tasks.filter((t) => t.status === "done").sort((a, b) => ((a.completedAt ?? "") < (b.completedAt ?? "") ? 1 : -1));
      return { configured: true, tasks: [...open, ...done] };
    }
    case "create_task": {
      const title = str(args.title, 300);
      const by = str(args.by, 60);
      if (!title || !by) return { error: "title and by are required" };
      if (!stateConfigured()) return { error: "Internal storage is not configured" };
      const p = args.priority;
      const draft = {
        title,
        priority: (p === 1 || p === 2 || p === 3 ? p : 2) as 1 | 2 | 3,
        project: str(args.project, 120),
        note: str(args.note, 2000),
        supportTicket: args.supportTicket === true,
        definitiveSolution: args.definitiveSolution === true,
        origin: "agent" as const,
        by,
      };
      draft.priority = effectivePriority(draft);
      const task: PanelTask = makeTask(draft);
      await mutateState((s) => {
        if (!s.tasks.some((t) => t.id === task.id)) s.tasks.push(task);
      });
      return { ok: true, task };
    }
    case "update_task": {
      const id = str(args.id, 80) ?? "";
      const action = str(args.action, 20) ?? "";
      const by = str(args.by, 60);
      if (!id || !by || !["toggle", "priority", "update"].includes(action)) return { error: "id, by and a valid action are required" };
      if (!stateConfigured()) return { error: "Internal storage is not configured" };
      const cur = (await getState(0)).tasks.find((t) => t.id === id);
      if (!cur) return { error: "Task not found" };
      const toggleTarget = cur.status === "open" ? "done" : "open";
      let updated: PanelTask | null = null;
      await mutateState((s) => {
        const t = s.tasks.find((x) => x.id === id);
        if (!t) return;
        if (action === "toggle") {
          t.status = toggleTarget;
          t.completedAt = toggleTarget === "done" ? t.completedAt ?? new Date().toISOString() : undefined;
        } else if (action === "priority") {
          const p = args.priority;
          t.priority = effectivePriority({ ...t, priority: (p === 1 || p === 2 || p === 3 ? p : t.priority) as 1 | 2 | 3 });
        } else {
          const title = str(args.title, 300);
          if (title) t.title = title;
          if (args.note !== undefined) t.note = str(args.note, 2000);
          if (args.project !== undefined) t.project = str(args.project, 120);
          const p = args.priority;
          if (p === 1 || p === 2 || p === 3) t.priority = p;
          t.priority = effectivePriority(t);
        }
        updated = { ...t };
        s.log.push(makeLogEntry({
          slug: t.project ?? "",
          account: ACCOUNTS.find((a) => a.slug === t.project)?.name ?? "Panel",
          action: "agent",
          by,
          kind: "log",
          status: "completed",
          title: `Task ${action}: ${t.title}`,
          detail: `by ${by}`,
        }));
      });
      return updated ? { ok: true, task: updated } : { error: "Task not found" };
    }
    case "add_log": {
      const slug = str(args.slug, 80) ?? "";
      const a = ACCOUNTS.find((x) => x.slug === slug);
      const title = str(args.title, 300);
      const by = str(args.by, 60);
      if (!a) return { error: "Unknown account slug" };
      if (!title || !by) return { error: "title and by are required" };
      if (!stateConfigured()) return { error: "Internal storage is not configured" };
      const detail = str(args.detail, 4000);
      const entry = makeLogEntry({
        slug: a.slug,
        account: a.name,
        action: "agent",
        by,
        kind: args.kind === "task" ? "task" : "log",
        status: args.status === "pending" ? "pending" : "completed",
        title,
        detail: `by ${by}${detail ? ` · ${detail}` : ""}`,
      });
      await mutateState((s) => { s.log.push(entry); });
      return { ok: true, entry };
    }
    case "list_log": {
      if (!stateConfigured()) return { configured: false, entries: [] };
      const s = await getState(0);
      const slug = str(args.slug, 80);
      const limit = typeof args.limit === "number" ? Math.min(200, Math.max(1, Math.floor(args.limit))) : 30;
      const entries = [...s.log].filter((e) => !slug || e.slug === slug).sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, limit);
      return { configured: true, entries };
    }
    case "ingest_reputation": {
      const slug = str(args.slug, 80) ?? "";
      const a = ACCOUNTS.find((x) => x.slug === slug);
      if (!a) return { error: "Unknown account slug" };
      if (!args.snapshot || typeof args.snapshot !== "object") return { error: "snapshot is required" };
      const state = await ingestAnalytics({ reputation: { [slug]: args.snapshot as never } });
      const saved = state.reputation?.[slug];
      return saved ? { ok: true, saved: reputationLine(saved), collectedAt: saved.collectedAt } : { error: "snapshot rejected: collectedAt and gbpLocation are required" };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

export async function GET() {
  // Sem stream de servidor para cliente: o protocolo permite responder
  // 405 ao GET quando o servidor só usa POST.
  return new NextResponse(null, { status: 405 });
}

export async function POST(req: Request) {
  const auth = authorized(req);
  if (auth === "unset") return NextResponse.json({ error: "PANEL_API_KEY is not configured" }, { status: 503 });
  if (auth === "bad") return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: Json };
  try {
    msg = (await req.json()) as typeof msg;
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (Array.isArray(msg)) return rpcError(null, -32600, "Batches are not supported", 400);
  const method = msg.method ?? "";
  const id = msg.id;

  if (method.startsWith("notifications/")) return new NextResponse(null, { status: 202 });

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "commander-center", version: "1.0.0" },
        instructions:
          "Commander Center of Magnetic Funnels. Call panel_status first to learn the account slugs. Never invent numbers: everything comes from the tools. Always pass your agent name in `by`. Search list_tasks before create_task; never duplicate an open task.",
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = typeof msg.params?.name === "string" ? msg.params.name : "";
      const args = (msg.params?.arguments && typeof msg.params.arguments === "object" ? msg.params.arguments : {}) as Json;
      if (!TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `Unknown tool ${name}`);
      try {
        const out = await callTool(name, args);
        const isErr = Boolean(out && typeof out === "object" && "error" in (out as Json));
        return rpcResult(id, { ...text(out), isError: isErr });
      } catch (e) {
        return rpcResult(id, { ...text({ error: e instanceof Error ? e.message : "tool failed" }), isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
