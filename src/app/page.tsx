import { ACCOUNTS } from "@/lib/accounts";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  empresa: "Empresa",
  comunidade: "Comunidade",
  cliente: "Clientes",
  projeto: "Marcas e projetos próprios",
  potencial: "Potenciais (fora do MVP)",
};

const SOURCE_LABEL: Record<string, string> = {
  "hl-location": "Location HighLevel própria",
  "hl-conexao": "Via conexão HighLevel",
  propria: "Fonte própria",
  mapear: "Fonte a mapear",
  "sem-subconta": "Aguardando subconta",
};

export default function Home() {
  const groups = ["empresa", "comunidade", "cliente", "projeto", "potencial"];
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", margin: "0 auto", maxWidth: 960, padding: "24px 16px", background: "#0B0F14", color: "#E8EEF4", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Commander Center</h1>
      <p style={{ color: "#9FB2C3", marginTop: 0 }}>
        Fortaleza de contas: clientes, projetos, empresa e comunidade. Status das credenciais abaixo.
      </p>
      {groups.map((kind) => {
        const items = ACCOUNTS.filter((a) => a.kind === kind);
        if (!items.length) return null;
        return (
          <section key={kind}>
            <h2 style={{ fontSize: 18, marginTop: 28 }}>{KIND_LABEL[kind]}</h2>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
              {items.map((a) => {
                const ready = a.pitEnv ? Boolean(process.env[a.pitEnv]) : null;
                return (
                  <article key={a.slug} style={{ border: "1px solid #22303E", borderRadius: 12, padding: 14, background: "#111922" }}>
                    <strong>{a.name}</strong>
                    <div style={{ color: "#9FB2C3", fontSize: 13, marginTop: 6 }}>
                      {a.locationId ? `Location: ${a.locationId}` : "Sem location HighLevel"}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 6 }}>
                      {SOURCE_LABEL[a.sourceStatus]}
                      {a.pitEnv
                        ? ready
                          ? ", credencial configurada"
                          : `, aguardando credencial: ${a.pitEnv}`
                        : ""}
                    </div>
                    {a.note ? <div style={{ color: "#9FB2C3", fontSize: 12, marginTop: 6 }}>{a.note}</div> : null}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </main>
  );
}
