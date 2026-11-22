import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Commander Center", description: "Fortress dashboard: clients, projects, company and community" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
