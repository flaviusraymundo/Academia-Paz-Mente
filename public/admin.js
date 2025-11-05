// public/admin.js
const $ = (id) => document.getElementById(id);

// Lê o token de forma robusta: aceita JSON {"token":"..."} ou string com/sem aspas
function readToken() {
  let v = ($("jwt")?.value || "").trim();
  // se colou o JSON inteiro
  if (v.startsWith("{")) {
    try {
      const j = JSON.parse(v);
      if (j && j.token) v = String(j.token);
    } catch {}
  }
  // remove aspas simples/duplas de borda
  v = v.replace(/^['"]+|['"]+$/g, "").trim();
  return v;
}

function authHeader() {
  const t = readToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function getJWT() {
  return readToken();
}

function setOut(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (typeof value === "string") {
    el.textContent = value;
  } else {
    try {
      el.textContent = JSON.stringify(value, null, 2);
    } catch (err) {
      el.textContent = String(value);
    }
  }
}

async function api(path, init = {}) {
  const token = getJWT();
  const headers = { ...(init.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: response.status, body };
}

function show(el, status, text) {
  el.textContent = `HTTP ${status}\n` + text;
}

// Ping (público)
document.getElementById("ping")?.addEventListener("click", async () => {
  const out = $("out");
  const r = await fetch("/api/health");
  show(out, r.status, await r.text());
});

// ADMIN: Listar cursos (requer JWT)
document.getElementById("listCourses")?.addEventListener("click", async () => {
  const out = $("listOut");
  const r = await fetch("/api/admin/courses", { headers: authHeader() });
  show(out, r.status, await r.text());
});

// Público: Listar trilhas/catálogo
document.getElementById("listTracks")?.addEventListener("click", async () => {
  const out = $("listOut");
  const r = await fetch("/api/catalog");
  show(out, r.status, await r.text());
});

// === CRUD ===
// Curso
document.getElementById("createCourse")?.addEventListener("click", async () => {
  const slug = $("c-slug").value.trim();
  const title = $("c-title").value.trim();
  const summary = $("c-summary").value.trim();
  const level = $("c-level").value.trim() || "beginner";
  const active = $("c-active").checked;
  const out = $("listOut");
  const r = await fetch("/api/admin/courses", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ slug, title, summary, level, active })
  });
  show(out, r.status, await r.text());
});

// Módulo
document.getElementById("createModule")?.addEventListener("click", async () => {
  const courseId = $("m-course").value.trim();
  const title = $("m-title").value.trim();
  const order = Number($("m-order").value || 0);
  const out = $("listOut");
  const r = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}/modules`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ title, order })
  });
  show(out, r.status, await r.text());
});

// Item
document.getElementById("createItem")?.addEventListener("click", async () => {
  const moduleId = $("i-module").value.trim();
  const type = $("i-type").value;
  const order = Number($("i-order").value || 0);
  const raw = $("i-payload").value.trim();
  let payload_ref = {};
  try { if (raw) payload_ref = JSON.parse(raw); } catch {}
  const out = $("listOut");
  const r = await fetch(`/api/admin/modules/${encodeURIComponent(moduleId)}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ type, order, payload_ref })
  });
  show(out, r.status, await r.text());
});

// Quiz do módulo
document.getElementById("createQuiz")?.addEventListener("click", async () => {
  const moduleId = $("q-module").value.trim();
  const passScore = Number($("q-pass").value || 70);
  const out = $("listOut");
  const r = await fetch(`/api/admin/modules/${encodeURIComponent(moduleId)}/quiz`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ passScore })
  });
  show(out, r.status, await r.text());
});

// Questão
document.getElementById("addQuestion")?.addEventListener("click", async () => {
  const quizId = $("qq-quiz").value.trim();
  const kind = $("qq-kind").value;
  const bodyRaw = $("qq-body").value.trim();
  const choicesRaw = $("qq-choices").value.trim();
  const answerRaw = $("qq-answer").value.trim();
  let body = {}, choices = [], answerKey = null;
  try { if (bodyRaw) body = JSON.parse(bodyRaw); } catch {}
  try { if (choicesRaw) choices = JSON.parse(choicesRaw); } catch {}
  try { if (answerRaw) answerKey = JSON.parse(answerRaw); } catch { answerKey = answerRaw; }
  const out = $("listOut");
  const r = await fetch(`/api/admin/quizzes/${encodeURIComponent(quizId)}/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ kind, body, choices, answerKey })
  });
  show(out, r.status, await r.text());
});

// Trilhas
document.getElementById("createTrack")?.addEventListener("click", async () => {
  const slug = $("t-slug").value.trim();
  const title = $("t-title").value.trim();
  const active = $("t-active").checked;
  const out = $("listOut");
  const r = await fetch(`/api/admin/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ slug, title, active })
  });
  show(out, r.status, await r.text());
});

document.getElementById("addTrackCourse")?.addEventListener("click", async () => {
  const trackId = $("tc-track").value.trim();
  const courseId = $("tc-course").value.trim();
  const order = Number($("tc-order").value || 0);
  const required = $("tc-required").checked;
  const out = $("listOut");
  const r = await fetch(`/api/admin/tracks/${encodeURIComponent(trackId)}/courses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ courseId, order, required })
  });
  show(out, r.status, await r.text());
});

// Pré-requisito
document.getElementById("addPrereq")?.addEventListener("click", async () => {
  const courseId = $("p-course").value.trim();
  const requiredCourseId = $("p-req").value.trim();
  const out = $("listOut");
  const r = await fetch(`/api/admin/courses/${encodeURIComponent(courseId)}/prerequisites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ requiredCourseId })
  });
  show(out, r.status, await r.text());
});

// =========================
// Aluno (teste)
// =========================
const $btnMeItems = document.getElementById("btnMeItems");
const $btnSubmitQ = document.getElementById("btnSubmitQuiz");
const $btnPageRead = document.getElementById("btnPageRead");
const $btnVideoBeat = document.getElementById("btnVideoBeat");

const $meCourse = document.getElementById("me-course");
const $meModule = document.getElementById("me-module");
const $meItem = document.getElementById("me-item");
const $meQuiz = document.getElementById("me-quiz");
const $meAnswers = document.getElementById("me-answers");

if ($btnMeItems) {
  $btnMeItems.addEventListener("click", async () => {
    const courseId = ($meCourse?.value || "").trim();
    if (!courseId) {
      setOut("meOut", "Informe courseId");
      return;
    }
    const { status, body } = await api(`/api/me/items?courseId=${encodeURIComponent(courseId)}`);
    const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    setOut("meOut", `HTTP ${status}\n${text}`);
  });
}

if ($btnSubmitQ) {
  $btnSubmitQ.addEventListener("click", async () => {
    const quizId = ($meQuiz?.value || "").trim();
    if (!quizId) {
      setOut("meOut", "Informe quizId");
      return;
    }
    let arr;
    try {
      arr = JSON.parse($meAnswers?.value || "[]");
      if (!Array.isArray(arr)) throw new Error("answers deve ser array");
    } catch (err) {
      setOut("meOut", "JSON inválido nas respostas: " + err.message);
      return;
    }
    const shapes = [
      (a) => ({ answers: a.map((x) => ({ questionId: x.questionId, choiceIds: x.choiceIds || x.value || x.choices || [] })) }),
      (a) => ({ answers: a.map((x) => ({ questionId: x.questionId, value: x.value || x.choiceIds || x.choices || [] })) }),
      (a) => ({ answers: a.map((x) => ({ questionId: x.questionId, choices: x.choices || x.choiceIds || x.value || [] })) })
    ];
    let last = null;
    for (const build of shapes) {
      const payload = build(arr);
      const { status, body } = await api(`/api/quizzes/${quizId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      last = { status, body, payload };
      if (status === 200) break;
    }
    setOut("meOut", last);
  });
}

if ($btnPageRead) {
  $btnPageRead.addEventListener("click", async () => {
    const courseId = ($meCourse?.value || "").trim();
    const moduleId = ($meModule?.value || "").trim();
    const itemId = ($meItem?.value || "").trim();
    const { status, body } = await api(`/api/events/page-read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, moduleId, itemId, ms: 15000 })
    });
    setOut("meOut", { status, body });
  });
}

if ($btnVideoBeat) {
  $btnVideoBeat.addEventListener("click", async () => {
    const courseId = ($meCourse?.value || "").trim();
    const moduleId = ($meModule?.value || "").trim();
    const itemId = ($meItem?.value || "").trim();
    const { status, body } = await api(`/api/video/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, moduleId, itemId, secs: 15 })
    });
    setOut("meOut", { status, body });
  });
}
