"use client";
import { useEffect, useRef, useState } from "react";

let muxPlayerLoader: Promise<void> | null = null;

function ensureMuxPlayerElement(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (window.customElements?.get("mux-player")) {
    return Promise.resolve();
  }
  if (!muxPlayerLoader) {
    const loader = new Promise<void>((resolve, reject) => {
      const existing = document.getElementById("mux-player-loader");
      if (existing) {
        if (existing.getAttribute("data-loaded") === "1") {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("mux-player loader error")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.id = "mux-player-loader";
      script.src = "https://cdn.jsdelivr.net/npm/@mux/mux-player@2/dist/mux-player.umd.min.js";
      script.async = true;
      script.addEventListener(
        "load",
        () => {
          script.setAttribute("data-loaded", "1");
          resolve();
        },
        { once: true }
      );
      script.addEventListener("error", () => reject(new Error("mux-player loader error")), { once: true });
      document.head.appendChild(script);
    });
    muxPlayerLoader = loader.catch((err) => {
      muxPlayerLoader = null;
      throw err;
    });
  }
  return muxPlayerLoader;
}

type Props = {
  playbackId?: string | null;
  playbackToken?: string | null;
  onPlayChange?: (playing: boolean) => void;
  poster?: string | null;
  debug?: boolean;
};

/**
 * Wrapper para o web component <mux-player>.
 * Aceita playbackId e (opcional) playbackToken (signed).
 */
export function VideoPlayer({ playbackId, playbackToken, poster, onPlayChange, debug }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = "";
    setError(null);
    setReady(false);
    setPlaying(false);
    if (!playbackId) {
      setError("playbackId ausente");
      return;
    }
    let disposed = false;
    let el: HTMLElement | null = null;

    const onLoaded = () => {
      if (!disposed) setReady(true);
    };
    const onPlay = () => {
      if (!disposed) {
        setPlaying(true);
        onPlayChange?.(true);
      }
    };
    const onPause = () => {
      if (!disposed) {
        setPlaying(false);
        onPlayChange?.(false);
      }
    };
    const onError = (e: Event) => {
      if (!disposed) {
        setError("erro no player");
        console.warn("mux-player error", e);
      }
    };

    ensureMuxPlayerElement()
      .then(() => {
        if (!ref.current || disposed) return;
        el = document.createElement("mux-player");
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
        el.setAttribute("muted", "false");
        el.setAttribute("playsinline", "true");
        if (poster) {
          el.setAttribute("poster", poster);
        }
        el.addEventListener("loadeddata", onLoaded);
        el.addEventListener("play", onPlay);
        el.addEventListener("pause", onPause);
        el.addEventListener("error", onError);
        ref.current.appendChild(el);
        if (!ref.current.contains(el)) {
          setError("mux-player não foi inicializado");
        }
      })
      .catch((e) => {
        if (disposed) return;
        console.warn(e);
        setError("falha ao carregar mux-player");
      });

    return () => {
      disposed = true;
      if (el) {
        el.removeEventListener("loadeddata", onLoaded);
        el.removeEventListener("play", onPlay);
        el.removeEventListener("pause", onPause);
        el.removeEventListener("error", onError);
      }
    };
  }, [playbackId, playbackToken, poster, onPlayChange]);

  return (
    <div data-testid="video-player-wrapper" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div ref={ref} />
      {debug && (
        <div style={{ fontSize: 12, color: "#666" }}>
          estado: {ready ? "ready" : "loading"} · playing: {playing ? "yes" : "no"} · playbackId: <code>{playbackId || "-"}</code> · token: <code>{playbackToken ? "•••" : "-"}</code>
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: "#a00" }}>
          {error} (verifique entitlement ou playbackId inválido)
        </div>
      )}
    </div>
  );
}
