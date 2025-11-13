import { useEffect, useRef } from "react";
import { api } from "../lib/api";

type HeartbeatOpts = {
  enabled: boolean;
  jwt: string;
  courseId: string;
  moduleId: string;
  itemId: string;
  intervalMs?: number; // default 15000
};

/**
 * Dispara heartbeat periódico enquanto `enabled` for true.
 * Interrompe automaticamente em unmount ou quando qualquer dependência muda.
 */
export function useVideoHeartbeat(opts: HeartbeatOpts) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const { enabled, jwt, courseId, moduleId, itemId, intervalMs = 15000 } = opts;

    // Limpa qualquer timer anterior
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!enabled || !jwt || !itemId) return;

    async function sendBeat() {
      try {
        await api(`/api/video/heartbeat`, {
          method: "POST",
          body: JSON.stringify({ courseId, moduleId, itemId, secs: Math.round(intervalMs / 1000) }),
          jwt,
        });
      } catch {
        // Em produção, poderíamos registrar no logger do cliente (silencioso por ora)
      }
    }

    // Envia um batimento inicial rápido
    sendBeat();

    // Configura timer
    const id = window.setInterval(sendBeat, intervalMs);
    timerRef.current = id;

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, opts.jwt, opts.courseId, opts.moduleId, opts.itemId, opts.intervalMs]);
}
