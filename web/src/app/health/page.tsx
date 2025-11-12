"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

export default function HealthPage() {
  const [out, setOut] = useState<any>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { status, body } = await api("/api/health");
      if (!alive) return;
      setOut({
        status,
        body,
        NEXT_PUBLIC_API_BASE: (process.env.NEXT_PUBLIC_API_BASE || "(não definida)"),
      });
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div>
      <h1>Health</h1>
      <p style={{ color:"#666" }}>
        API base: <code>{process.env.NEXT_PUBLIC_API_BASE || "(não definida)"}</code>
      </p>
      <pre>{JSON.stringify(out, null, 2)}</pre>
    </div>
  );
}
