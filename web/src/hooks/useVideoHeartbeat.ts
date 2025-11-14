"use client";

import { useEffect, useRef } from "react";
import api from "../lib/api";
import { USE_COOKIE_MODE } from "../lib/config";

type HeartbeatOpts = {
  enabled: boolean;
  jwt?: string | null;
  courseId: string;
  moduleId: string;
  itemId: string;
  intervalMs?: number; // default 15000
  onBeat?: (payload: { at: number }) => void;
};

/**
 * Dispara heartbeat periódico enquanto `enabled` for true.
 * Interrompe automaticamente em unmount ou quando qualquer dependência muda.
 * Pode receber callback onBeat para telemetria local (debug).
 */
export function useVideoHeartbeat(opts: HeartbeatOpts) {
  const timerRef = useRef<number | null>(null);
  const lastBeatRef = useRef<number>(Date.now());
  const onBeatRef = useRef<typeof opts.onBeat>();

  useEffect(() => {
    onBeatRef.current = opts.onBeat;
  }, [opts.onBeat]);

  useEffect(() => {
    const { enabled, jwt, courseId, moduleId, itemId, intervalMs = 15000 } = opts;

    // Limpa qualquer timer anterior
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!enabled || !itemId) return;
    if (!USE_COOKIE_MODE && !jwt) return;

    async function sendBeat() {
      lastBeatRef.current = Date.now();
      try {
        await api(`/api/video/heartbeat`, {
          method: "POST",
          body: JSON.stringify({ courseId, moduleId, itemId, secs: Math.round(intervalMs / 1000) }),
          jwt: jwt ?? null,
        });
        onBeatRef.current?.({ at: lastBeatRef.current });
      } catch {
        // Silencioso por ora
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
    // Importante: não incluir opts.onBeat nas dependências para evitar recriar o intervalo
  }, [opts.enabled, opts.jwt, opts.courseId, opts.moduleId, opts.itemId, opts.intervalMs]);
}
