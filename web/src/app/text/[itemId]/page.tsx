"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { useAuth } from "../../../contexts/AuthContext";

export default function TextItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const qs = useSearchParams();
  const courseId = qs.get("courseId") || "";
  const moduleId = qs.get("moduleId") || "";
  const { jwt, ready } = useAuth();
  const [out, setOut] = useState<any>(null);

  async function pageRead() {
    const { status, body } = await api(`/api/events/page-read`, {
      method: "POST",
      body: JSON.stringify({ courseId, moduleId, itemId, ms: 15000 })
    });
    setOut({ status, body });
  }

  const DEBUG = process.env.NEXT_PUBLIC_DEBUG === "1";

  return (
    <div>
      <h1>Texto</h1>
      <p><strong>itemId:</strong> <code>{itemId}</code></p>
      <p><strong>courseId:</strong> <code>{courseId || "-"}</code></p>
      <p><strong>moduleId:</strong> <code>{moduleId || "-"}</code></p>
      {ready && jwt && DEBUG && (
        <>
          <button onClick={pageRead} style={{ padding: "8px 12px" }}>Enviar page-read (15s)</button>
          {out && <pre style={{ marginTop: 12 }}>{JSON.stringify(out, null, 2)}</pre>}
        </>
      )}
    </div>
  );
}
