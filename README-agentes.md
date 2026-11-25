# Porta dos agentes (MCP) e reputação no Google — 2026-11-25

## O que mudou
- `src/app/api/mcp/route.ts`: endpoint MCP (Streamable HTTP, JSON-RPC 2.0, só POST) para os agentes do OpenBot. Exige `x-panel-key` = env `PANEL_API_KEY` (sem a env, responde 503) e, nos domínios `*.vercel.app`, o header `x-vercel-protection-bypass` do Vercel. Ferramentas: `panel_status`, `account_summary`, `list_tasks`, `create_task`, `update_task`, `add_log`, `list_log`, `ingest_reputation`. Toda escrita leva `by` = nome do agente e vira entrada no log.
- `src/lib/reputation.ts` + `analytics.ts`: seção `reputation` (por slug) nos snapshots, com histórico. Chega por `ingest_reputation` ou por `POST /api/collector/ingest` `{ "reputation": { "<slug>": {...} } }`.
- `/v2/account/[slug]`, aba Website & Google: bloco "Google reviews" quando há snapshot (média, total, novas 30d, respostas 30d, tempo de resposta, negativas sem resposta, ações do perfil). A pendência "Google reviews are not measurable yet" some da lista de Setup gaps quando o snapshot existe.
- `/api/tasks` e `/api/log`: aceitam `by`; tarefa nasce com `origin: "agent"`, log com `action: "agent"`.

## Reversível
Sem `PANEL_API_KEY`, o MCP fica fechado (503) e nada mais muda. Sem snapshot de reputação, as telas ficam como antes.

## Coletor de reputação (roda num agente do OpenBot, 1x/dia)
Para cada conta com perfil no Google: `GOOGLE_BUSINESS_PROFILE_GET_REVIEWS` (Composio) → montar o `ReputationSnapshot` (ver `src/lib/reputation.ts`) → `ingest_reputation { slug, snapshot }`. O mapa slug → location do GBP fica na skill do agente (não há segredo nele).
