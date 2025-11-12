import type { ReactNode } from "react";
import TokenBar from "../components/TokenBar";

export const metadata = {
  title: "Academia Paz & Mente - Aluno",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-br">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <TokenBar />
        <main style={{ padding: 16, maxWidth: 960, margin: "0 auto" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
