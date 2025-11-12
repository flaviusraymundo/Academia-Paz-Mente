import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import { ClientAuthBar } from "../components/ClientAuthBar";

export const metadata = {
  title: "Academia Paz & Mente - Aluno",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-br">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fafafa" }}>
        <ClientAuthBar />
        <nav style={{ padding: "8px 16px", borderBottom: "1px solid #eee", display: "flex", gap: 16, background: "#fff" }}>
          <Link href="/">Catálogo</Link>
          <Link href="/certificates">Certificados</Link>
        </nav>
        <main style={{ padding: 24, maxWidth: 1040, margin: "0 auto" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
