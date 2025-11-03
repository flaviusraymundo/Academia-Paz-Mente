// public/tracking.js
(function () {
  const API = "/api/events";
  const MAX_QUEUE = 50;
  const FLUSH_MS = 5000;

  const hasCryptoUUID = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function";
  function rid() { try { return hasCryptoUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); } catch { return String(Date.now()); } }

  const KEY = "lms_anon_id";
  let anonId = localStorage.getItem(KEY);
  if (!anonId) { anonId = rid(); localStorage.setItem(KEY, anonId); }

  const sessionKey = "lms_session_id";
  let sessionId = sessionStorage.getItem(sessionKey);
  if (!sessionId) { sessionId = rid(); sessionStorage.setItem(sessionKey, sessionId); }

  let q = [];
  let timer = null;

  function enqueue(ev) {
    q.push(ev);
    if (q.length >= MAX_QUEUE) flush();
    else if (!timer) timer = setTimeout(flush, FLUSH_MS);
  }

  function baseEvent(type, payload) {
    return {
      type,
      dt: new Date().toISOString(),
      path: location.pathname + location.search,
      referrer: document.referrer || undefined,
      sessionId,
      anonId,
      payload: payload || {}
    };
  }

  async function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!q.length) return;
    const batch = q.slice(); q = [];
    const body = JSON.stringify({ events: batch });
    try {
      // Tenta beacon para não bloquear navegação
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(API, blob);
      } else {
        await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      }
    } catch (_) {
      // se falhar, refile a fila uma vez
      q = batch.concat(q);
    }
  }

  // Eventos básicos
  function track(type, payload) { enqueue(baseEvent(type, payload)); }
  window.__track = track;         // expõe para uso no app
  window.__trackFlush = flush;

  // Page view inicial
  track("page.view");

  // Clicks com data-track="nome"
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-track]");
    if (!el) return;
    const name = el.getAttribute("data-track") || "ui.click";
    track(name, {
      tag: el.tagName,
      id: el.id || undefined,
      cls: el.className || undefined,
      href: el.getAttribute("href") || undefined,
      text: (el.innerText || "").slice(0, 80)
    });
  });

  // Navegação SPA (se usar pushState)
  const _push = history.pushState;
  history.pushState = function () {
    _push.apply(this, arguments);
    track("nav.push");
  };
  window.addEventListener("popstate", () => track("nav.pop"));

  // Flush ao sair/ocultar
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("beforeunload", () => flush());
})();
