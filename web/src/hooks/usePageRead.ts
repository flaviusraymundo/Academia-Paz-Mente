"use client";

import { useEffect, useRef } from "react";
import { api } from "../lib/api";

type PageReadOpts = {
  enabled: boolean;
  jwt: string;
  courseId: string;
  moduleId: string;
  itemId: string;
  intervalMs?: number; // default 15000
  onBeat?: (at: number) => void;
};

/**
 * Dispara page-read periódico enquanto `enabled` for true.
 * Faz cleanup automático ao desmontar ou mudar dependências relevantes.
 * Mantém callback onBeat em ref para evitar recriar interval a cada render.
 */
export function usePageRead(opts: PageReadOpts) {
  const timerRef = useRef<number | null>(null);
  const onBeatRef = useRef<typeof opts.onBeat>();

  useEffect(() => {
    onBeatRef.current = opts.onBeat;
  }, [opts.onBeat]);

  useEffect(() => {
    const { enabled, jwt, courseId, moduleId, itemId, intervalMs = 15000 } = opts;

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!enabled || !jwt || !courseId || !moduleId || !itemId) {
      return;
    }

    async function send(ms: number) {
      try {
        await api("/api/events/page-read", {
          method: "POST",
          body: JSON.stringify({ courseId, moduleId, itemId, ms }),
          jwt,
        });
        onBeatRef.current?.(Date.now());
      } catch {
        // silencioso em produção
      }
    }

    send(1000);
    const id = window.setInterval(() => send(intervalMs), intervalMs);
    timerRef.current = id;

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [opts.enabled, opts.jwt, opts.courseId, opts.moduleId, opts.itemId, opts.intervalMs]);
}
