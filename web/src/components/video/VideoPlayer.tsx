"use client";
import { useEffect, useRef, useState } from "react";

type Props = {
  playbackId?: string | null;
  playbackToken?: string | null;
  onPlayChange?: (playing: boolean) => void;
  poster?: string | null;
  debug?: boolean;
};

const MUX_SCRIPT_ID = "mux-player-loader";

/**
 * Garante que o custom element <mux-player> esteja registrado.
 * Estratégia:
 * 1) Se já estiver definido em customElements, resolve imediatamente.
 * 2) Injeta <script type="module" src="https://unpkg.com/@mux/mux-player@1"> como fallback.
 *    - Se existir um script #mux-player-loader "stale" (sem data-loaded), remove e cria um novo.
 *    - Marca data-loaded/data-error para evitar listeners "perdidos" após erro.
 */
async function ensureMuxDefined(): Promise<void> {
  if (typeof window === "undefined") return;
  const w = window as any;

  if (w?.customElements?.get?.("mux-player")) return;

  // Fallback por CDN com remoção de script "stale"
  const prev = document.getElementById(MUX_SCRIPT_ID) as HTMLScriptElement | null;
  if (prev) {
    const loaded = prev.dataset.loaded === "1";
    if (!loaded) {
      // Script anterior falhou ou ficou pendurado: remove para permitir novo load
      prev.remove();
    } else {
      // Já "loaded", mas por algum motivo o custom element não está definido.
      // Deixamos seguir adiante sem duplicar script; nada a fazer aqui.
      return;
    }
  }

  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.id = MUX_SCRIPT_ID;
    s.type = "module";
    s.src = "https://unpkg.com/@mux/mux-player@1";
    const onLoad = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    const onError = () => {
      s.dataset.error = "1";
      // Evita script "stale" que impediria novas tentativas
      s.remove();
      reject(new Error("mux-player script failed to load"));
    };
    s.addEventListener("load", onLoad, { once: true });
    s.addEventListener("error", onError, { once: true });
    document.head.appendChild(s);
  });
}

/**
 * Wrapper para o web component <mux-player>.
 * Aceita playbackId e (opcional) playbackToken (signed).
 */
export function VideoPlayer({ playbackId, playbackToken, poster, onPlayChange, debug }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  // Guarda o callback em um ref para evitar recriar o player quando a identidade muda
  const cbRef = useRef<typeof onPlayChange>();
  useEffect(() => {
    cbRef.current = onPlayChange;
  }, [onPlayChange]);

  // Instancia o player somente quando playbackId/token/poster mudam
  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;

    // Reinicia estado local
    container.innerHTML = "";
    setError(null);
    setReady(false);
    setPlaying(false);

    if (!playbackId) {
      setError("playbackId ausente");
      return;
    }

    (async () => {
      try {
        await ensureMuxDefined();
        if (cancelled) return;

        const el = document.createElement("mux-player") as any;
        el.setAttribute("stream-type", "on-demand");
        el.setAttribute("playback-id", playbackId);
        el.setAttribute("data-testid", "mux-player");
        if (playbackToken) {
          el.setAttribute("playback-token", playbackToken);
        }
        el.setAttribute(
          "style",
          "width:100%;max-width:960px;aspect-ratio:16/9;background:#000;border-radius:12px;overflow:hidden"
        );
        el.setAttribute("prefer-mse", "true");
        // NÃO usar atributo booleano 'muted' com valor "false" (presença => true)
        el.setAttribute("playsinline", "true");
        if (poster) {
          el.setAttribute("poster", poster);
        }
        // Garantir áudio ligado por padrão
        el.muted = false;
        el.volume = 1;

        const onLoaded = () => setReady(true);
        const onPlay = () => {
          setPlaying(true);
          cbRef.current?.(true);
        };
        const onPause = () => {
          setPlaying(false);
          cbRef.current?.(false);
        };
        const onError = () => {
          setError("erro no player");
        };

        el.addEventListener("loadeddata", onLoaded);
        el.addEventListener("play", onPlay);
        el.addEventListener("pause", onPause);
        el.addEventListener("error", onError);

        container.appendChild(el);

        cleanup = () => {
          el.removeEventListener("loadeddata", onLoaded);
          el.removeEventListener("play", onPlay);
          el.removeEventListener("pause", onPause);
          el.removeEventListener("error", onError);
        };
      } catch (e: any) {
        if (cancelled) return;
        setError("falha ao carregar o player (tente recarregar a página)");
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // Importante: o callback vive no ref cbRef; manter deps restritas evita reinstanciar o player.
  }, [playbackId, playbackToken, poster]);

  return (
    <div data-testid="video-player-wrapper" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div ref={hostRef} />
      {debug && (
        <div style={{ fontSize: 12, color: "#666" }}>
          estado: {ready ? "ready" : "loading"} · playing: {playing ? "yes" : "no"} · playbackId: <code>{playbackId || "-"}</code> ·
          token: <code>{playbackToken ? "•••" : "-"}</code>
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: "#a00" }}>
          {error} (verifique entitlement, playbackId ou conexão de rede)
        </div>
      )}
    </div>
  );
}
