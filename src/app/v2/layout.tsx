import type { ReactNode } from "react";
import "./v2.css";
import { ACCOUNTS } from "@/lib/accounts";
import { fetchAllV2 } from "@/lib/v2data";
import Chrome, { type SearchEntry } from "@/components/v2/Chrome";
import { TZ } from "@/components/viz";

export const dynamic = "force-dynamic";

/**
 * Chrome do Commander Center 2.0: sidebar + barra superior (busca
 * global, período, refresh). O índice da busca e o total de
 * "waiting" do badge saem da mesma coleta do painel (cache de 5
 * minutos compartilhado com a versão atual). Se a coleta falhar, o
 * chrome degrada para vazio e as páginas mostram o próprio estado.
 */
export default async function V2Layout({ children }: { children: ReactNode }) {
  let waitingTotal = 0;
  const index: SearchEntry[] = [];
  try {
    const contas = ACCOUNTS.filter((a) => a.kind !== "potencial");
    const data = await fetchAllV2(contas);
    const bySlug = new Map(data.map((d) => [d.slug, d]));
    waitingTotal = data.reduce((s, d) => s + d.waitingCount, 0);
    for (const a of contas) {
      index.push({ kind: "account", label: a.name, sub: "Account", href: `/v2/account/${a.slug}` });
      const d = bySlug.get(a.slug);
      if (!d) continue;
      for (const c of d.searchContacts) {
        index.push({
          kind: "contact",
          label: c.name,
          sub: `${a.name}${c.phone ? ` · ${c.phone}` : ""}`,
          href: `/v2/account/${a.slug}`,
        });
      }
      for (const w of d.waiting.slice(0, 5)) {
        index.push({
          kind: "contact",
          label: w.contactName,
          sub: `${a.name} · waiting for reply`,
          href: "/v2/waiting",
        });
      }
    }
  } catch { /* o chrome não pode derrubar as páginas */ }

  const updatedLabel = `Chicago ${new Date().toLocaleString("en-US", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ,
  })}`;

  return (
    <Chrome waitingTotal={waitingTotal} index={index} updatedLabel={updatedLabel}>
      {children}
    </Chrome>
  );
}
