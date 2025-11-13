"use client";
import { useAuth } from "../contexts/AuthContext";
import { useState, type CSSProperties } from "react";

function decodeJwt(token: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const json = atob(payload);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function DebugToolbar() {
  const { jwt, logout } = useAuth();
  const [decoded, setDecoded] = useState<any>(null);
  const DEBUG = process.env.NEXT_PUBLIC_DEBUG === "1";

  if (!DEBUG) return null;

  function handleDecode() {
    setDecoded(jwt ? decodeJwt(jwt) : null);
  }
  function handleCopy() {
    if (!jwt) {
      alert("Nenhum JWT disponível.");
      return;
    }
    try {
      navigator.clipboard.writeText(jwt);
      alert("JWT copiado.");
    } catch {
      alert("Falha ao copiar.");
    }
  }
  function handleClear() {
    logout();
    setDecoded(null);
  }

  return (
    <div
      style={{
        padding: "6px 12px",
        background: "#fff",
        borderBottom: "1px solid #eee",
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
        fontSize: 12,
      }}
    >
      <strong style={{ fontSize: 12 }}>DEBUG</strong>
      <button style={btn} onClick={handleDecode}>Decodificar JWT</button>
      <button style={btn} onClick={handleCopy}>Copiar</button>
      <button style={btnDanger} onClick={handleClear}>Limpar</button>
      <a style={link} href="/health">Health</a>
      <span style={{ marginLeft: "auto", fontSize: 11, color: "#666" }}>
        API: <code>{process.env.NEXT_PUBLIC_API_BASE || "?"}</code>
      </span>
      {decoded && (
        <pre
          style={{
            flexBasis: "100%",
            margin: 0,
            background: "#f8f8fa",
            padding: 8,
            border: "1px solid #ddd",
            borderRadius: 6,
            maxHeight: 240,
            overflow: "auto",
          }}
        >
          {JSON.stringify(decoded, null, 2)}
        </pre>
      )}
    </div>
  );
}

const btn: CSSProperties = {
  padding: "4px 8px",
  fontSize: 11,
  background: "#f5f5f7",
  border: "1px solid #ccc",
  borderRadius: 6,
  cursor: "pointer",
};
const btnDanger: CSSProperties = {
  ...btn,
  background: "#ffecec",
  borderColor: "#e99",
  color: "#a00",
};
const link: CSSProperties = {
  ...btn,
  textDecoration: "none",
  lineHeight: "16px",
};
