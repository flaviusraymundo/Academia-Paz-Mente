import type { ReactNode } from "react";
import Link from "next/link";
import TokenBar from "../src/components/TokenBar";

export const metadata = {
  title: "Academia Paz & Mente - Aluno",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-br">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <TokenBar />
        <nav style={{ padding: "8px 12px", borderBottom: "1px solid #eee", display: "flex", gap: 12 }}>
          <Link href="/">Catálogo</Link>
          <Link href="/certificates">Certificados</Link>
        </nav>
        <main style={{ padding: 16, maxWidth: 960, margin: "0 auto" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
