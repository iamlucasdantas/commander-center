import type { ReactNode } from "react";

export const metadata = { title: "Commander Center", description: "Painel fortaleza: clientes, projetos, empresa e comunidade" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
