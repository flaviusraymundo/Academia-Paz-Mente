"use client";

import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { USE_COOKIE_MODE } from "../lib/config";

type PageReadOpts = {
  enabled: boolean;
  jwt?: string | null;
  courseId: string;
  moduleId: string;
  itemId: string;
  intervalMs?: number; // default 15000
  onBeat?: (at: number, final?: boolean) => void; // final=true no flush de encerramento
};

/**
 * Dispara page-read periódico enquanto `enabled` for true.
 * Faz cleanup automático ao desmontar ou mudar dependências relevantes.
 * Mantém callback onBeat em ref para evitar recriar interval a cada render.
 */
export function usePageRead(opts: PageReadOpts) {
  const timerRef = useRef<number | null>(null);
  const onBeatRef = useRef<typeof opts.onBeat>();
  const lastAtRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const flushedFinalRef = useRef(false);

  useEffect(() => {
    onBeatRef.current = opts.onBeat;
  }, [opts.onBeat]);

  useEffect(() => {
    const wasActive = activeRef.current;
    if (timerRef.current && wasActive) {
      flushFinal();
    }
    flushedFinalRef.current = false;

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const { enabled, jwt, courseId, moduleId, itemId, intervalMs = 15000 } = opts;
    if (!enabled || !courseId || !moduleId || !itemId) {
      activeRef.current = false;
      return;
    }
    if (!USE_COOKIE_MODE && !jwt) {
      activeRef.current = false;
      return;
    }

    activeRef.current = true;
    lastAtRef.current = Date.now();

    async function sendDelta(final = false) {
      const now = Date.now();
      const prev = lastAtRef.current ?? now;
      const delta = Math.max(0, now - prev);

      // avança antes do await para ignorar latência da request
      lastAtRef.current = now;

      try {
        await api("/api/events/page-read", {
          method: "POST",
          body: JSON.stringify({ courseId, moduleId, itemId, ms: delta }),
          jwt: jwt ?? null,
        });
      } catch {
        // silencioso
      } finally {
        onBeatRef.current?.(now, final);
      }
    }

    function flushFinal() {
      if (!activeRef.current) return;
      if (flushedFinalRef.current) return;
      flushedFinalRef.current = true;
      if (lastAtRef.current != null) {
        void sendDelta(true);
      }
    }

    void sendDelta(false);
    const id = window.setInterval(() => {
      void sendDelta(false);
    }, intervalMs);
    timerRef.current = id;

    return () => {
      // flush final antes de limpar o intervalo para não perder delta pendente
      flushFinal();
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      activeRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    opts.enabled,
    opts.jwt,
    opts.courseId,
    opts.moduleId,
    opts.itemId,
    opts.intervalMs,
  ]);
}
