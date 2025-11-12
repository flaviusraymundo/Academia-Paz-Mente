"use client";

import { useEffect, useState } from "react";

export default function TokenBar() {
  const [token, setToken] = useState("");

  useEffect(() => {
    try {
      const t = localStorage.getItem("jwt") || "";
      setToken(t);
    } catch {}
  }, []);

  function save() {
    try {
      localStorage.setItem("jwt", token.trim());
      alert("Token salvo.");
    } catch {
      alert("Falha ao salvar token no localStorage.");
    }
  }

  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee", display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 12, color: "#666" }}>JWT:</span>
      <input
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="cole o JWT do aluno aqui"
        style={{ flex: 1, padding: "6px 8px", fontFamily: "monospace", fontSize: 12 }}
      />
      <button onClick={save} style={{ padding: "6px 10px" }}>Salvar</button>
    </div>
  );
}
