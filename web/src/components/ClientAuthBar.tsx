"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

export function ClientAuthBar() {
  const { jwt, setJwt, logout } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (showModal) setDraft(jwt);
  }, [jwt, showModal]);

  function handleSave() {
    setJwt(draft);
    setShowModal(false);
  }

  return (
    <>
      <div data-e2e="auth-bar" style={{
        padding: "8px 16px",
        borderBottom: "1px solid #eee",
        background: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16
      }}>
        <strong style={{ fontSize: 14 }}>Academia Paz & Mente</strong>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {jwt ? (
            <>
              <span style={{ fontSize: 12, color: "#555" }}>Autenticado</span>
              <button data-e2e="auth-logout-btn" onClick={logout} style={btnStyle}>Sair</button>
            </>
          ) : (
            <button data-e2e="auth-login-btn" onClick={() => setShowModal(true)} style={btnPrimaryStyle}>Entrar</button>
          )}
        </div>
      </div>
      {showModal && (
        <div style={modalWrap}>
          <div style={modalCard}>
            <h3 style={{ marginTop: 0 }}>Entrar</h3>
            <p style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
              Temporário: cole o JWT (vamos evoluir para login com senha).
            </p>
            <textarea
              data-e2e="auth-jwt-input"
              rows={4}
              placeholder="Cole o JWT"
              style={areaStyle}
              onChange={(e) => setDraft(e.target.value)}
              value={draft}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button data-e2e="auth-save-btn" onClick={handleSave} style={btnPrimaryStyle}>Salvar</button>
              <button data-e2e="auth-cancel-btn" onClick={() => setShowModal(false)} style={btnStyle}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  background: "#fff",
  border: "1px solid #ccc",
  borderRadius: 6,
  cursor: "pointer",
};

const btnPrimaryStyle: React.CSSProperties = {
  ...btnStyle,
  background: "#0366d6",
  color: "#fff",
  border: "1px solid #0366d6",
};

const modalWrap: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 999,
};

const modalCard: React.CSSProperties = {
  background: "#fff",
  borderRadius: 10,
  padding: 16,
  width: "100%",
  maxWidth: 420,
  boxShadow: "0 4px 18px rgba(0,0,0,.25)",
  border: "1px solid #e2e2e2",
};

const areaStyle: React.CSSProperties = {
  width: "100%",
  resize: "vertical",
  fontFamily: "monospace",
  fontSize: 12,
  padding: 8,
  borderRadius: 6,
  border: "1px solid #ccc",
};
