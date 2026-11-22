# Passo a passo das credenciais, só isto falta o Lucas fazer

O projeto está pronto em `app/` (Next.js, padrão GitHub > Vercel, igual ao Food Truck QC).
O registro de contas está em `src/lib/accounts.ts`. Nenhuma chave fica no código.

## 1. Criar o projeto no Vercel
Importar o repositório, raiz em `app/`. (A Muse faz esta parte com o Lucas, ou ele importa e ela confere o deploy.)

## 2. Colar as credenciais (Vercel > projeto > Settings > Environment Variables)
Um PIT por location do HighLevel. O PIT é gerado dentro de cada subconta:
HighLevel > subconta > Settings > Private Integrations > criar integração com leitura de contatos, conversas, oportunidades e calendários > copiar o token (começa com `pit-`).

| Variável | Conta |
|---|---|
| HL_PIT_MAGNETIC_FUNNELS_US | Magnetic Funnels (US) |
| HL_PIT_COMUNIDADE_MAGNETIC_FLOWS | Comunidade Magnetic Flows |
| HL_PIT_MAGNETIC_FLOWS_COMMUNITY | Magnetic Flows Community |
| HL_PIT_SUMTHIN_DIFFERENT | Sumthin' Different |
| HL_PIT_THE_BAR_AESTHETICS | The Bar Aesthetics and Wellness |
| HL_PIT_MUSCATINE_TREE_SERVICE | Muscatine Tree Service |
| HL_PIT_QC_AESTHETICS | Quad Cities Aesthetics |
| HL_PIT_QC_HOME_RENOVATION | Quad Cities Home Renovation |
| HL_PIT_QC_HOUSE_CLEANING | Quad Cities House Cleaning |

Plataforma: HUB_ADMIN_PASSWORD (senha do painel), SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (banco novo do Hub, a Muse cria e passa os nomes), CRON_SECRET.
Fontes próprias e Fase 2 (podem ficar para depois): FTQC_API_KEY, FAM_SOURCE_KEY, GA4_SERVICE_ACCOUNT_JSON e os GA4_ por site. Lista completa em `app/.env.example`.

## 3. Conferir
Abrir `/api/status` no domínio do projeto: cada conta mostra "configurada" ou "aguardando credencial", sem expor valor nenhum. A página inicial mostra o mesmo, por grupo.

## Observação importante
As chaves que hoje estão no Hub do Lovable NÃO foram copiadas para cá de propósito: elas ficam em texto puro lá. O ideal é gerar um PIT novo por location para a v2 e, depois que a v2 estiver no ar, revogar os antigos.

<!-- Redeploy 2026-11-22: ativar no Vercel as variáveis HL_PIT_* atualizadas (integrações próprias "Commander Center" por subconta, com contacts.write; token do Simpson Ltd recriado). Commit sem mudança de código. -->
<!-- Redeploy 2026-11-22 (2): ativar as variáveis HL_PIT_SUMTHIN_DIFFERENT, HL_PIT_QC_AESTHETICS, HL_PIT_QC_HOME_RENOVATION, HL_PIT_QC_HOUSE_CLEANING e HL_PIT_MUSCATINE_TREE_SERVICE regravadas com os tokens rotacionados no HighLevel. Commit sem mudança de código. -->
