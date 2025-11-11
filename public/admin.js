// public/admin.js
const $ = (id) => document.getElementById(id);
const isUuid = (s) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "")
  );
function readToken() {
  try {
    const t = localStorage.getItem("lms_jwt");
    if (t) return t.trim();
  } catch {}
  return (
    (document.getElementById("jwt")?.value || "")
      .trim()
      .replace(/^['"]+|['"]+$/g, "")
  );
}
async function api(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${readToken()}`);
  headers.set("Content-Type", headers.get("Content-Type") || "application/json");
  const r = await fetch(path, { ...init, headers });
  let body;
  try {
    body = await r.json();
  } catch {
    body = await r.text();
  }
  return { status: r.status, body };
}
function setOut(id, v) {
  const el = $(id);
  if (!el) return;
  el.textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

const CREATION_STATE_KEY = "admin_creation_state";
function updateCreationState(patch = {}) {
  try {
    const prev = JSON.parse(localStorage.getItem(CREATION_STATE_KEY) || "{}") || {};
    const next = { ...prev, ...patch };
    localStorage.setItem(CREATION_STATE_KEY, JSON.stringify(next));
    const el = document.getElementById("creation-state");
    if (el) el.textContent = JSON.stringify(next, null, 2);
  } catch {
    /* ignore */
  }
}

function authHeader() {
  const t = readToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function buildUuidPayloadFromInputs() {
  const courseId = (document.getElementById("me-course")?.value || "").trim();
  const moduleId = (document.getElementById("me-module")?.value || "").trim();
  const itemId = (document.getElementById("me-item")?.value || "").trim();
  const payload = {};
  if (isUuid(courseId)) payload.courseId = courseId;
  if (isUuid(moduleId)) payload.moduleId = moduleId;
  if (isUuid(itemId)) payload.itemId = itemId;
  return payload;
}

// =========================
// Entitlements (grant/revoke)
// =========================
async function loadGrantCourses() {
  const grantSel = $("grant-course");
  if (grantSel) grantSel.innerHTML = "";
  const { status, body } = await api("/api/admin/courses/_summary");
  if (status !== 200 || !body?.courses) {
    setOut("grantOut", { status, body });
    return;
  }
  for (const c of body.courses) {
    if (grantSel) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.title} (${c.slug})`;
      grantSel.appendChild(opt);
    }
  }
  if (!body.courses.length) {
    if (grantSel) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "— nenhum curso —";
      grantSel.appendChild(opt);
    }
  }
  setOut("grantOut", `Cursos carregados (${body.courses.length}).`);
}

document.getElementById("grant-load-courses")?.addEventListener("click", loadGrantCourses);
document.getElementById("btnIssueCert")?.addEventListener("click", async () => {
  const userId = (document.getElementById("cert-user")?.value || "").trim();
  const courseId = (document.getElementById("cert-course")?.value || "").trim();
  const fullName = (document.getElementById("cert-fullname")?.value || "").trim();
  if (!userId || !courseId) return setOut("certOut", { error: "informe userId e courseId" });
  const qs = new URLSearchParams({ force: "1" });
  if (fullName) qs.set("fullName", fullName);
  const { status, body } = await api(
    `/api/admin/certificates/${encodeURIComponent(userId)}/${encodeURIComponent(courseId)}/issue?${qs.toString()}`,
    { method: "POST" }
  );
  setOut("certOut", { status, body });
});

document.getElementById("btnReissueCert")?.addEventListener("click", async () => {
  const userId = (document.getElementById("cert-user")?.value || "").trim();
  const courseId = (document.getElementById("cert-course")?.value || "").trim();
  const fullName = (document.getElementById("cert-fullname")?.value || "").trim();
  if (!userId || !courseId) return setOut("certOut", { error: "informe userId e courseId" });
  const qs = new URLSearchParams({ force: "1", reissue: "1" });
  if (fullName) qs.set("fullName", fullName);
  const { status, body } = await api(
    `/api/admin/certificates/${encodeURIComponent(userId)}/${encodeURIComponent(courseId)}/issue?${qs.toString()}`,
    { method: "POST" }
  );
  setOut("certOut", { status, body });
});

document.getElementById("btnReissueKeepDate")?.addEventListener("click", async () => {
  const userId = (document.getElementById("cert-user")?.value || "").trim();
  const courseId = (document.getElementById("cert-course")?.value || "").trim();
  const fullName = (document.getElementById("cert-fullname")?.value || "").trim();
  if (!userId || !courseId) return setOut("certOut", { error: "informe userId e courseId" });
  const qs = new URLSearchParams({ force: "1", reissue: "1", keepIssuedAt: "1" });
  if (fullName) qs.set("fullName", fullName);
  const { status, body } = await api(
    `/api/admin/certificates/${encodeURIComponent(userId)}/${encodeURIComponent(courseId)}/issue?${qs.toString()}`,
    { method: "POST" }
  );
  setOut("certOut", { status, body });
});
window.addEventListener("DOMContentLoaded", () => {
  loadGrantCourses().catch(() => {});
});

document.getElementById("grant-search")?.addEventListener("click", async () => {
  const email = ($("grant-email")?.value || "").trim();
  if (!email) return setOut("grantOut", { error: "Informe um email" });
  const { status, body } = await api(
    `/api/admin/users/_search?email=${encodeURIComponent(email)}`
  );
  if (status !== 200) return setOut("grantOut", { status, body });
  const u = body.users?.[0];
  if (!u) return setOut("grantOut", { info: "Nenhum usuário encontrado" });
  $("grant-user").value = u.id;
  setOut("grantOut", u);
});

document.getElementById("btnGrant")?.addEventListener("click", async () => {
  const userId = ($("grant-user")?.value || "").trim();
  const courseId = ($("grant-course")?.value || "").trim();
  if (!isUuid(userId)) return setOut("grantOut", { error: "userId inválido" });
  if (!isUuid(courseId)) return setOut("grantOut", { error: "courseId inválido" });
  const startsAtRaw = (document.getElementById("grant-startsAt")?.value || "").trim();
  const endsAtRaw = (document.getElementById("grant-endsAt")?.value || "").trim();
  const durDaysRaw = (document.getElementById("grant-durationDays")?.value || "").trim();

  const toIso = (s) => {
    if (!s) return undefined;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  };

  let startsAt = toIso(startsAtRaw);
  let endsAt = toIso(endsAtRaw);

  if (!endsAt && durDaysRaw) {
    const n = parseInt(durDaysRaw, 10);
    if (!Number.isNaN(n) && n > 0) {
      const base = startsAt ? new Date(startsAt) : new Date();
      const end = new Date(base.getTime());
      end.setUTCDate(end.getUTCDate() + n);
      endsAt = end.toISOString();
      if (!startsAt) startsAt = new Date().toISOString();
    }
  }

  const payload = { userId, courseId, source: "grant" };
  if (startsAt) payload.startsAt = startsAt;
  if (endsAt) payload.endsAt = endsAt;

  const { status, body } = await api("/api/admin/entitlements", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setOut("grantOut", { status, body });
});

document.getElementById("btnRevoke")?.addEventListener("click", async () => {
  const userId = ($("grant-user")?.value || "").trim();
  const courseId = ($("grant-course")?.value || "").trim();
  if (!isUuid(userId)) return setOut("grantOut", { error: "userId inválido" });
  if (!isUuid(courseId)) return setOut("grantOut", { error: "courseId inválido" });
  const { status, body } = await api("/api/admin/entitlements", {
    method: "POST",
    body: JSON.stringify({ userId, courseId, revoke: true }),
  });
  setOut("grantOut", { status, body });
});

function show(outEl, status, bodyText) {
  const body = (() => {
    try {
      return JSON.parse(bodyText);
    } catch {
      return bodyText;
    }
  })();
  setOut(outEl.id, { status, body });
}

// =========================
// Criar aluno (admin)
// =========================
document.getElementById("createUser")?.addEventListener("click", async () => {
  const email = (document.getElementById("new-email")?.value || "")
    .trim()
    .toLowerCase();
  if (!email) return setOut("userOut", { error: "informe um email" });
  const { status, body } = await api("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  setOut("userOut", { status, body });
  if (status === 200 && body?.user?.id) {
    const grantEmail = document.getElementById("grant-email");
    const grantUser = document.getElementById("grant-user");
    if (grantEmail) grantEmail.value = body.user.email || email;
    if (grantUser) grantUser.value = body.user.id;
    setOut("grantOut", { hint: "Aluno criado. userId preenchido para concessão." });
  }
});

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

// Listar cursos + contagens (rota protegida _summary evita conflito com :id)
document.getElementById("listCoursesCounts")?.addEventListener("click", async () => {
  const out = $("listOut");
  const { status, body } = await api("/api/admin/courses/_summary");
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  show(out, status, text);
});

// ADMIN: Listar trilhas
document.getElementById("listTracks")?.addEventListener("click", async () => {
  const out = $("listOut");
  const { status, body } = await api("/api/admin/tracks/_summary");
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  show(out, status, text);
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

// === Importação em lote ===
async function runBatchImport(simulate) {
  const ta = document.getElementById("batch-json");
  const blank = document.getElementById("batch-blank");
  const out = document.getElementById("batchOut");
  if (!ta || !out) return;
  let data;
  try {
    data = JSON.parse(ta.value || "{}");
  } catch (e) {
    out.textContent = "JSON inválido: " + (e?.message || e);
    return;
  }
  if (simulate) data.simulate = true;
  data.blankMedia = !!blank?.checked;

  const { status, body } = await api("/api/admin/courses/import" + (simulate ? "?simulate=1" : ""), {
    method: "POST",
    body: JSON.stringify(data)
  });
  out.textContent = JSON.stringify({ status, body }, null, 2);

  // Se import real, preencher campo de publicar/excluir com novo ID
  if (!simulate && status === 200 && body?.course?.id) {
    const pub = document.getElementById("pub-course");
    if (pub) pub.value = body.course.id;
    updateCreationState({ lastCourseId: body.course.id });
  }
}

document.getElementById("btnBatchSimulate")?.addEventListener("click", () => runBatchImport(true));
document.getElementById("btnBatchImport")?.addEventListener("click", () => runBatchImport(false));

// === Clone / Publish / Delete Draft ===
document.getElementById("btnCloneCourse")?.addEventListener("click", async () => {
  const source = (document.getElementById("cl-source")?.value || "").trim();
  const newSlug = (document.getElementById("cl-slug")?.value || "").trim();
  const newTitle = (document.getElementById("cl-title")?.value || "").trim();
  const blankMedia = !!document.getElementById("cl-blank")?.checked;
  const includeQuestions = !!document.getElementById("cl-questions")?.checked;
  const simulate = !!document.getElementById("cl-simulate")?.checked;
  const mode = document.getElementById("cl-mode")?.value || "clone";
  if (!source || !newSlug || !newTitle) {
    setOut("cl-out", { error: "source, newSlug e newTitle são obrigatórios" });
    return;
  }
  const { status, body } = await api(`/api/admin/courses/${encodeURIComponent(source)}/clone`, {
    method: "POST",
    body: JSON.stringify({ newSlug, newTitle, mode, blankMedia, includeQuestions, simulate })
  });
  setOut("cl-out", { status, body });
  if (status === 200 && body?.course?.id) {
    // Atualiza painel de estado rápido
    updateCreationState({ lastCourseId: body.course.id });
    // Preenche o campo do draft para publicar/excluir rapidamente
    const pub = document.getElementById("pub-course");
    if (pub) pub.value = body.course.id;
  }
});

document.getElementById("btnPublishCourse")?.addEventListener("click", async () => {
  const courseId = (document.getElementById("pub-course")?.value || "").trim();
  if (!courseId) {
    setOut("cl-out", { error: "Informe courseId draft" });
    return;
  }
  const { status, body } = await api(`/api/admin/courses/${encodeURIComponent(courseId)}/publish`, {
    method: "POST"
  });
  setOut("cl-out", { status, body });
});

document.getElementById("btnDeleteCourse")?.addEventListener("click", async () => {
  const courseId = (document.getElementById("pub-course")?.value || "").trim();
  if (!courseId) {
    setOut("cl-out", { error: "Informe courseId draft" });
    return;
  }
  if (!confirm("Confirma excluir (soft delete) este draft?")) return;
  const { status, body } = await api(`/api/admin/courses/${encodeURIComponent(courseId)}`, {
    method: "DELETE"
  });
  setOut("cl-out", { status, body });
});

// Copiar ID do campo "pub-course"
document.getElementById("btnCopyDraftId")?.addEventListener("click", async () => {
  const el = document.getElementById("pub-course");
  const value = (el?.value || "").trim();
  if (!value) { setOut("cl-out", { error: "Nenhum ID no campo" }); return; }
  try {
    await navigator.clipboard.writeText(value);
    setOut("cl-out", { info: "ID copiado para a área de transferência", id: value });
  } catch {
    setOut("cl-out", { error: "Falha ao copiar ID" });
  }
});

// Listar drafts
document.getElementById("btnListDrafts")?.addEventListener("click", async () => {
  const { status, body } = await api(`/api/admin/courses/_drafts`);
  const out = document.getElementById("draftsOut");
  if (out) {
    out.textContent = JSON.stringify(body, null, 2);
  } else {
    setOut("cl-out", { status, body });
  }
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
  const txt = await r.text();
  show(out, r.status, txt);

  // Se checkbox 'criar questão placeholder' estiver marcado, tenta criar automaticamente
  try {
    if (r.ok && document.getElementById("q-autoplaceholder")?.checked) {
      let parsed;
      try { parsed = JSON.parse(txt); } catch {}
      const quizId = parsed?.body?.quiz?.id || parsed?.body?.row?.id || parsed?.body?.id || parsed?.quiz?.id;
      if (quizId) {
        const payload = {
          kind: "single",
          body: { prompt: "Pergunta exemplo (edite depois)" },
          choices: [
            { id: "A", text: "Opção A" },
            { id: "B", text: "Opção B" },
            { id: "C", text: "Opção C" },
            { id: "D", text: "Opção D" }
          ],
          answerKey: ["A"]
        };
        const rq = await fetch(`/api/admin/quizzes/${encodeURIComponent(quizId)}/questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(payload)
        });
        const respTxt = await rq.text();
        show(out, rq.status, respTxt);
        const qqField = document.getElementById("qq-quiz");
        if (qqField) qqField.value = quizId;
      }
    }
  } catch {}
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

// ===== Editor de questões (estruturado) =====
(function mountQuestionEditor() {
  const $quiz = document.getElementById("qe-quiz");
  const $load = document.getElementById("qe-load");
  const $list = document.getElementById("qe-list");
  const $editor = document.getElementById("qe-editor");
  const $id = document.getElementById("qe-id");
  const $kind = document.getElementById("qe-kind");
  const $prompt = document.getElementById("qe-prompt");
  const $choicesList = document.getElementById("qe-choices-list");
  const $choicesBlock = document.getElementById("qe-choices");
  const $addChoice = document.getElementById("qe-add-choice");
  const $save = document.getElementById("qe-save");
  const $cancel = document.getElementById("qe-cancel");
  if (!$quiz || !$load || !$list || !$editor || !$id || !$kind || !$prompt || !$choicesList || !$choicesBlock || !$addChoice || !$save || !$cancel) {
    return;
  }

  let cachedQuestions = [];

  function getQuizId() {
    return ($quiz.value || "").trim();
  }

  function renderList(questions) {
    if (!questions?.length) {
      $list.innerHTML = '<em data-testid="qe-empty">Sem questões</em>';
      return;
    }

    const rows = questions
      .map((q, idx) => {
        const promptText = q.body?.prompt || "(sem prompt)";
        return `
          <div class="qe-item" data-testid="qe-item" style="display:flex;justify-content:space-between;align-items:center;border:1px solid #eee;padding:6px 8px;border-radius:6px;margin-bottom:6px;">
            <div>
              <div style="font-weight:600">${idx + 1}. [${q.kind}] ${promptText}</div>
              <div style="font-size:12px;color:#555">id: ${q.id}</div>
            </div>
            <div style="display:flex;gap:6px;">
              <button data-edit="${q.id}" data-testid="qe-edit">Editar</button>
              <button data-del="${q.id}" data-testid="qe-delete">Excluir</button>
            </div>
          </div>
        `;
      })
      .join("");
    $list.innerHTML = rows;

    $list.querySelectorAll("button[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => startEdit(btn.getAttribute("data-edit")));
    });
    $list.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const qid = btn.getAttribute("data-del");
        if (!qid) return;
        if (!window.confirm("Excluir questão?")) return;
        const { status, body } = await api(`/api/admin/questions/${encodeURIComponent(qid)}`, {
          method: "DELETE",
        });
        setOut("listOut", { status, body });
        await loadQuestions();
      });
    });
  }

  function addChoiceRow(idVal = "", textVal = "", correct = false) {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "6px";
    row.style.alignItems = "center";
    row.style.marginBottom = "4px";
    row.innerHTML = `
      <input class="qe-choice-id" placeholder="ID" value="${idVal}" data-testid="qe-choice-id" />
      <input class="qe-choice-text" placeholder="Texto" value="${textVal}" size="40" data-testid="qe-choice-text" />
      <label><input type="checkbox" class="qe-choice-correct" data-testid="qe-choice-correct" ${correct ? "checked" : ""}/> correta</label>
      <button type="button" class="qe-choice-del" data-testid="qe-choice-remove">x</button>
    `;
    row.querySelector(".qe-choice-del")?.addEventListener("click", () => row.remove());
    $choicesList.appendChild(row);
  }

  function syncChoiceUI() {
    const kind = $kind.value;
    if ($choicesBlock) {
      const show = kind === "truefalse" || kind === "single" || kind === "multiple";
      $choicesBlock.style.display = show ? "block" : "none";
    }
  }

  function startEdit(id) {
    const q = cachedQuestions.find((item) => item.id === id);
    if (!q) return;

    $id.value = q.id;
    $kind.value = q.kind;
    $prompt.value = q.body?.prompt || "";

    while ($choicesList.firstChild) $choicesList.removeChild($choicesList.firstChild);
    const choices = Array.isArray(q.choices) ? q.choices : [];
    const rawAnswer = q.answerKey ?? q.answer_key;
    for (const choice of choices) {
      let correct = false;
      if (Array.isArray(rawAnswer)) {
        correct = rawAnswer.includes(choice.id);
      } else if (typeof rawAnswer === "boolean" && q.kind === "truefalse") {
        if (choice.id === "T") correct = rawAnswer === true;
        if (choice.id === "F") correct = rawAnswer === false;
      }
      addChoiceRow(choice.id, choice.text, correct);
    }

    $editor.style.display = "block";
    syncChoiceUI();
  }

  function collectQuestion() {
    const id = $id.value;
    const kind = $kind.value;
    const prompt = $prompt.value;
    const rows = Array.from($choicesList.querySelectorAll(":scope > div"));
    const choices = rows
      .map((row) => {
        const cid = String(row.querySelector(".qe-choice-id")?.value || "").trim();
        const text = String(row.querySelector(".qe-choice-text")?.value || "").trim();
        const correct = Boolean(row.querySelector(".qe-choice-correct")?.checked);
        return cid && text ? { id: cid, text, correct } : null;
      })
      .filter(Boolean);

    let answerKey;
    if (kind === "truefalse") {
      const hasTf = choices.some((c) => c.id === "T" || c.id === "F");
      const firstCorrect = choices.find((c) => c.correct);
      const val = hasTf ? firstCorrect?.id === "T" : true;
      answerKey = Boolean(val);
    } else if (kind === "single") {
      const corr = choices.find((c) => c.correct)?.id;
      answerKey = corr ? [corr] : [];
    } else {
      const corr = choices.filter((c) => c.correct).map((c) => c.id);
      answerKey = corr;
    }

    return {
      id,
      payload: {
        kind,
        body: { prompt },
        choices: choices.map(({ id: choiceId, text }) => ({ id: choiceId, text })),
        answerKey,
      },
    };
  }

  async function loadQuestions() {
    const quizId = getQuizId();
    if (!quizId) {
      cachedQuestions = [];
      renderList(cachedQuestions);
      return;
    }
    const { status, body } = await api(
      `/api/admin/quizzes/${encodeURIComponent(quizId)}/questions`
    );
    setOut("listOut", { status, body });
    if (status === 200 && Array.isArray(body?.questions)) {
      cachedQuestions = body.questions.map((q) => ({ ...q, answerKey: q.answer_key ?? q.answerKey }));
    } else {
      cachedQuestions = [];
    }
    renderList(cachedQuestions);
  }

  $load.addEventListener("click", () => {
    loadQuestions().catch((err) => {
      setOut("listOut", { error: String(err?.message || err) });
    });
  });

  $addChoice.addEventListener("click", () => addChoiceRow());
  $kind.addEventListener("change", syncChoiceUI);

  $save.addEventListener("click", async () => {
    const quizId = getQuizId();
    if (!quizId) return;
    const q = collectQuestion();
    if (!q.id) {
      setOut("listOut", { error: "Selecione uma questão para editar" });
      return;
    }
    const { status, body } = await api(
      `/api/admin/questions/${encodeURIComponent(q.id)}`,
      {
        method: "PUT",
        body: JSON.stringify(q.payload),
      }
    );
    setOut("listOut", { status, body });
    await loadQuestions();
    $editor.style.display = "none";
  });

  $cancel.addEventListener("click", () => {
    $editor.style.display = "none";
  });

  syncChoiceUI();
})();

// ===== Templates de questão =====
function setQuestionTemplate(kind) {
  const kindSel = document.getElementById("qq-kind");
  const bodyInp = document.getElementById("qq-body");
  const choicesInp = document.getElementById("qq-choices");
  const answerInp = document.getElementById("qq-answer");
  if (!kindSel || !bodyInp || !choicesInp || !answerInp) return;

  let tpl = null;
  switch (kind) {
    case "single":
      tpl = {
        kind: "single",
        body: { prompt: "Pergunta (single): Qual das opções é correta?" },
        choices: [
          { id: "A", text: "Opção A" },
          { id: "B", text: "Opção B" },
          { id: "C", text: "Opção C" },
          { id: "D", text: "Opção D" }
        ],
        answer: ["A"]
      };
      break;
    case "multiple":
      tpl = {
        kind: "multiple",
        body: { prompt: "Pergunta (multiple): Quais opções são corretas?" },
        choices: [
          { id: "A", text: "Opção A" },
          { id: "B", text: "Opção B" },
          { id: "C", text: "Opção C" },
          { id: "D", text: "Opção D" }
        ],
        answer: ["A", "C"]
      };
      break;
    case "truefalse":
      tpl = {
        kind: "truefalse",
        body: { prompt: "A afirmação a seguir é verdadeira?" },
        choices: [
          { id: "T", text: "Verdadeiro" },
          { id: "F", text: "Falso" }
        ],
        answer: true
      };
      break;
    case "likert5":
      tpl = {
        kind: "multiple",
        body: { prompt: "Avalie sua concordância (Likert 1-5)" },
        choices: [
          { id: "1", text: "Discordo totalmente" },
          { id: "2", text: "Discordo" },
          { id: "3", text: "Neutro" },
          { id: "4", text: "Concordo" },
          { id: "5", text: "Concordo totalmente" }
        ],
        answer: [] // sem correta; use como pesquisa/escala
      };
      break;
  }
  if (!tpl) return;
  kindSel.value = tpl.kind;
  bodyInp.value = JSON.stringify(tpl.body);
  choicesInp.value = JSON.stringify(tpl.choices);
  answerInp.value =
    typeof tpl.answer === "boolean" || typeof tpl.answer === "number"
      ? String(tpl.answer)
      : JSON.stringify(tpl.answer);
}

document.getElementById("qq-tpl-single")?.addEventListener("click", () => setQuestionTemplate("single"));
document.getElementById("qq-tpl-multiple")?.addEventListener("click", () => setQuestionTemplate("multiple"));
document.getElementById("qq-tpl-truefalse")?.addEventListener("click", () => setQuestionTemplate("truefalse"));
document.getElementById("qq-tpl-likert5")?.addEventListener("click", () => setQuestionTemplate("likert5"));

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
const $btnMeModules = document.getElementById("btnMeModules");
const $btnMeModulesSummary = document.getElementById("btnMeModulesSummary");
const $btnMeProgressSummary = document.getElementById("btnMeProgressSummary");
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

if ($btnMeModules) {
  $btnMeModules.addEventListener("click", async () => {
    const courseId = ($meCourse?.value || "").trim();
    if (!isUuid(courseId)) {
      setOut("meOut", { error: "Informe um courseId válido (UUID)." });
      return;
    }
    const { status, body } = await api(
      `/api/me/modules?courseId=${encodeURIComponent(courseId)}`
    );
    if (status === 200 && Array.isArray(body?.items)) {
      const compact = body.items.map((m) => ({
        id: m.id ?? m.module_id,
        title: m.title,
        unlocked: m.unlocked,
        status: m.progress?.status,
        score: m.progress?.score,
        itemCount: m.itemCount ?? (Array.isArray(m.items) ? m.items.length : undefined),
      }));
      setOut("meOut", { status, compact, raw: body });
    } else {
      setOut("meOut", { status, body });
    }
  });
}

if ($btnMeModulesSummary) {
  $btnMeModulesSummary.addEventListener("click", async () => {
    const courseId = ($meCourse?.value || "").trim();
    if (!isUuid(courseId)) {
      setOut("meOut", { error: "Informe um courseId válido (UUID)." });
      return;
    }
    const { status, body } = await api(
      `/api/me/modules-summary?courseId=${encodeURIComponent(courseId)}`
    );
    if (status === 200 && Array.isArray(body?.items)) {
      const compact = body.items.map((m) => ({
        id: m.id,
        title: m.title,
        unlocked: m.unlocked,
        status: m.progress?.status,
        score: m.progress?.score,
      }));
      setOut("meOut", { status, compact, raw: body });
    } else {
      setOut("meOut", { status, body });
    }
  });
}

if ($btnMeProgressSummary) {
  $btnMeProgressSummary.addEventListener("click", async () => {
    const courseId = ($meCourse?.value || "").trim();
    if (!isUuid(courseId)) {
      setOut("meOut", { error: "Informe um courseId válido (UUID)." });
      return;
    }
    const { status, body } = await api(
      `/api/me/progress-summary?courseId=${encodeURIComponent(courseId)}`
    );
    if (status === 200 && body && body.totals) {
      setOut("meOut", {
        status,
        totals: body.totals,
        percent: body.percent,
        raw: body,
      });
    } else {
      setOut("meOut", { status, body });
    }
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
    const base = buildUuidPayloadFromInputs();
    const { status, body } = await api(`/api/events/page-read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...base, ms: 15000 })
    });
    setOut("meOut", { status, body });
  });
}

if ($btnVideoBeat) {
  $btnVideoBeat.addEventListener("click", async () => {
    const base = buildUuidPayloadFromInputs();
    const { status, body } = await api(`/api/video/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...base, secs: 15 })
    });
    setOut("meOut", { status, body });
  });
}

// -------------------------------
// Reorder (drag-and-drop)
// -------------------------------
(function mountReorder() {
  const $course = document.getElementById("reorder-course");
  const $module = document.getElementById("reorder-module");
  const $load = document.getElementById("reorder-load");
  const $box = document.getElementById("reorder-box");
  const $list = document.getElementById("reorder-list");
  const $save = document.getElementById("reorder-save");
  const $out = document.getElementById("reorder-out");
  if (!$course || !$module || !$load || !$list || !$save) return;

  const baseBg = "#ffffff";
  const highlightBg = "#c8ffe9";
  let currentModuleId = null;

  function dragHandleStyle() {
    return "cursor:grab;font-weight:600;padding:4px 8px;background:#0a7661;color:#fff;border-radius:6px;margin-right:8px;user-select:none;";
  }

  function clearHighlights() {
    Array.from($list.children).forEach((child) => {
      child.style.background = baseBg;
    });
  }

  function createRow(item) {
    const row = document.createElement("div");
    row.draggable = true;
    row.dataset.itemId = item.item_id || item.id;
    row.style.border = "1px solid #0a766133";
    row.style.borderRadius = "10px";
    row.style.padding = "10px 12px";
    row.style.background = baseBg;
    row.style.display = "flex";
    row.style.alignItems = "flex-start";
    row.style.gap = "10px";
    row.style.boxShadow = "0 2px 4px rgb(0 0 0 / 0.06)";

    const handle = document.createElement("span");
    handle.textContent = "⣿⣿";
    handle.style.cssText = dragHandleStyle();

    const order = document.createElement("span");
    order.textContent = `#${item.order ?? ""}`;
    order.style.cssText = "font-size:12px;color:#0a7661;width:32px;font-weight:600;";

    const body = document.createElement("div");
    const type = (item.type && String(item.type).toUpperCase()) || "ITEM";
    const idLabel = item.item_id || item.id;
    body.innerHTML = `
      <div style="font-weight:600;color:#033;">${type}</div>
      <div style="font-size:11px;color:#555;word-break:break-all;">${idLabel}</div>
    `;

    row.append(handle, order, body);

    row.addEventListener("dragstart", (event) => {
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", row.dataset.itemId || "");
      row.style.opacity = "0.5";
      clearHighlights();
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      row.style.opacity = "1";
      clearHighlights();
    });

    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      const dragging = $list.querySelector(".dragging");
      if (!dragging || dragging === row) return;
      const rect = row.getBoundingClientRect();
      const before = event.clientY - rect.top < rect.height / 2;
      $list.insertBefore(dragging, before ? row : row.nextSibling);
      clearHighlights();
      row.style.background = highlightBg;
    });

    row.addEventListener("drop", (event) => {
      event.preventDefault();
      clearHighlights();
    });

    row.addEventListener("dragleave", () => {
      row.style.background = baseBg;
    });

    return row;
  }

  function resetUI() {
    $list.innerHTML = "";
    $box.style.display = "none";
  }

  async function loadCourses() {
    setOut("reorder-out", "");
    $course.innerHTML = "";
    $module.innerHTML = "";
    currentModuleId = null;
    resetUI();

    const { status, body } = await api("/api/admin/courses/_summary");
    if (status !== 200 || typeof body !== "object" || !body) {
      setOut("reorder-out", { status, body });
      return;
    }

    const courses = Array.isArray(body.courses) ? body.courses : [];
    if (courses.length === 0) {
      setOut("reorder-out", "Nenhum curso encontrado.");
      return;
    }

    for (const course of courses) {
      const option = document.createElement("option");
      option.value = course.id;
      option.textContent = `${course.title} (${course.slug})`;
      $course.appendChild(option);
    }

    await loadModulesOfCourse();
  }

  async function loadModulesOfCourse() {
    setOut("reorder-out", "");
    $module.innerHTML = "";
    currentModuleId = null;
    resetUI();

    const courseId = $course.value;
    if (!courseId) {
      setOut("reorder-out", "Escolha um curso válido.");
      return;
    }

    const { status, body } = await api(`/api/admin/courses/${encodeURIComponent(courseId)}/modules`);
    if (status !== 200 || typeof body !== "object" || !body) {
      setOut("reorder-out", { status, body });
      return;
    }

    const modules = Array.isArray(body.modules) ? body.modules : [];
    if (modules.length === 0) {
      setOut("reorder-out", "Nenhum módulo encontrado para o curso.");
      return;
    }

    for (const mod of modules) {
      const option = document.createElement("option");
      option.value = mod.id;
      option.textContent = `#${mod.order} ${mod.title}`;
      $module.appendChild(option);
    }
  }

  async function loadItems() {
    setOut("reorder-out", "");
    currentModuleId = $module.value || null;
    if (!currentModuleId) {
      setOut("reorder-out", "Escolha um módulo.");
      return;
    }

    resetUI();

    const { status, body } = await api(`/api/admin/modules/${encodeURIComponent(currentModuleId)}/items`);
    if (status !== 200 || typeof body !== "object" || !body) {
      setOut("reorder-out", { status, body });
      return;
    }

    const items = Array.isArray(body.items) ? body.items : [];
    for (const item of items) {
      $list.appendChild(
        createRow({ id: item.id, item_id: item.id, type: item.type, order: item.order })
      );
    }

    $box.style.display = "block";
  }

  async function saveOrder() {
    if (!currentModuleId) {
      setOut("reorder-out", "Nenhum módulo carregado.");
      return;
    }

    const itemIds = Array.from($list.children, (child) => child.dataset.itemId).filter(Boolean);
    const { status, body } = await api(`/api/admin/modules/${encodeURIComponent(currentModuleId)}/reorder`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds })
    });

    setOut("reorder-out", { status, body });
  }

  $course.addEventListener("change", loadModulesOfCourse);
  $load.addEventListener("click", loadItems);
  $save.addEventListener("click", saveOrder);

  loadCourses();
})();

// ===== Itens e Módulos (UI) =====
(function(){
  const $ = (id) => document.getElementById(id);

  // Usa o mesmo helper 'api' e 'authHeader' já existentes no admin.js
  // Se não existirem, defina versões mínimas:
  async function authHeaderSafe() {
    try { return typeof authHeader === "function" ? await authHeader() : {}; } catch { return {}; }
  }
  async function apiSafe(path, init={}) {
    try { return typeof api === "function" ? await api(path, init) : await (async () => {
      const headers = { "Content-Type":"application/json", ...(await authHeaderSafe()), ...(init.headers||{}) };
      const res = await fetch(path, { ...init, headers });
      let body = null; try { body = await res.json(); } catch { body = await res.text(); }
      return { status: res.status, body };
    })(); } catch (e) { return { status: 0, body: { error: "network_error", detail: String(e) } }; }
  }

  const state = {
    moduleId: null,
    // Estrutura dos itens no estado:
    // { id, type, order, payload_ref, __orig: { type, payloadRaw } }
    items: [],
    dirtyOrder: false,
  };

  function setOut(obj) {
    const out = $("im-out");
    if (!out) return;
    out.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  }

  function markOrderDirty(flag) {
    state.dirtyOrder = flag;
    const btn = $("im-save-order");
    if (btn) btn.disabled = !flag;
  }

  function renderItems() {
    const root = $("im-items");
    if (!root) return;
    if (!Array.isArray(state.items) || state.items.length === 0) {
      root.innerHTML = "<em>Nenhum item</em>";
      markOrderDirty(false);
      return;
    }
    root.innerHTML = "";
    state.items
      .sort((a,b)=>Number(a.order)-Number(b.order))
      .forEach((it, idx) => {
        const wrap = document.createElement("div");
        wrap.style.border = "1px solid #eee";
        wrap.style.padding = "8px";
        wrap.style.borderRadius = "6px";
        wrap.style.display = "grid";
        wrap.style.gap = "6px";

        const head = document.createElement("div");
        head.style.display = "flex";
        head.style.justifyContent = "space-between";
        head.style.alignItems = "center";
        head.innerHTML = `
          <div><b>Item</b> ${idx+1} — <code>${it.id}</code></div>
          <div style="display:flex;gap:6px;">
            <button data-up="${it.id}" ${idx===0 ? "disabled":""}>↑</button>
            <button data-down="${it.id}" ${idx===state.items.length-1 ? "disabled":""}>↓</button>
            <button data-del="${it.id}" style="color:#b00;border-color:#b00">Excluir</button>
          </div>
        `;
        wrap.appendChild(head);

        const row = document.createElement("div");
        row.style.display = "grid";
        row.style.gridTemplateColumns = "160px 1fr";
        row.style.gap = "6px";
        row.innerHTML = `
          <label>Tipo
            <select data-type="${it.id}">
              <option value="video">video</option>
              <option value="text">text</option>
              <option value="quiz">quiz</option>
            </select>
          </label>
          <label>payload_ref (JSON)
            <textarea data-payload="${it.id}" rows="6" style="width:100%;font-family:ui-monospace;"></textarea>
          </label>
        `;
        wrap.appendChild(row);

        const saveRow = document.createElement("div");
        saveRow.style.textAlign = "right";
        saveRow.innerHTML = `<button data-save="${it.id}">Salvar alterações</button>`;
        wrap.appendChild(saveRow);

        root.appendChild(wrap);

        // Preenche valores atuais
        const sel = root.querySelector(`select[data-type="${it.id}"]`);
        const txt = root.querySelector(`textarea[data-payload="${it.id}"]`);
        if (sel) sel.value = it.type;
        // Usa o payload original serializado. Se o backend não retornou payload_ref, deixa em branco.
        const initialRaw = it.__orig?.payloadRaw ?? (it.payload_ref != null ? JSON.stringify(it.payload_ref, null, 2) : "");
        if (txt) txt.value = initialRaw;
      });

    // wire actions
    root.querySelectorAll("button[data-up]").forEach((b) => {
      b.addEventListener("click", () => moveItem(b.getAttribute("data-up"), -1));
    });
    root.querySelectorAll("button[data-down]").forEach((b) => {
      b.addEventListener("click", () => moveItem(b.getAttribute("data-down"), +1));
    });
    root.querySelectorAll("button[data-del]").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-del");
        if (!confirm("Excluir este item?")) return;
        const r = await apiSafe(`/api/admin/items/${encodeURIComponent(id)}`, { method:"DELETE" });
        setOut({ deleteItem: r });
        if (r.status === 200) {
          state.items = state.items.filter(x => x.id !== id);
          renderItems();
        }
      });
    });
    root.querySelectorAll("button[data-save]").forEach((b) => {
      b.addEventListener("click", async () => {
        const id = b.getAttribute("data-save");
        const it = state.items.find(x => x.id === id);
        if (!it) return;

        const sel = root.querySelector(`select[data-type="${id}"]`);
        const txt = root.querySelector(`textarea[data-payload="${id}"]`);

        const wantType = sel?.value ?? it.type;

        // Monta body só com campos alterados
        const body = {};
        if (wantType !== it.__orig?.type) {
          body.type = wantType;
        }

        // Só envia payloadRef se o conteúdo do textarea mudou vs original
        let sendPayload = false;
        let newPayloadObj = undefined;
        const currentRaw = (txt?.value ?? "").trim();
        const origRaw = (it.__orig?.payloadRaw ?? "").trim();
        if (currentRaw !== origRaw) {
          if (currentRaw.length === 0) {
            // Texto vazio: considera payloadRef = {} (limpeza explícita)
            newPayloadObj = {};
            sendPayload = true;
          } else {
            try {
              newPayloadObj = JSON.parse(currentRaw);
              sendPayload = true;
            } catch {
              return setOut({ error:"payload_ref inválido (JSON malformado)" });
            }
          }
        }
        if (sendPayload) {
          body.payloadRef = newPayloadObj;
        }

        if (Object.keys(body).length === 0) {
          return setOut({ info:"Nada para salvar (sem alterações detectadas)" });
        }

        const r = await apiSafe(`/api/admin/items/${encodeURIComponent(id)}`, {
          method:"PUT",
          body: JSON.stringify(body)
        });
        setOut({ saveItem: r });

        if (r.status === 200) {
          // Atualiza estado e baseline
          const updated = r.body?.item || {};
          it.type = updated.type ?? wantType ?? it.type;
          it.payload_ref = updated.payload_ref ?? (sendPayload ? newPayloadObj : it.payload_ref);
          it.__orig = {
            type: it.type,
            payloadRaw: it.payload_ref != null ? JSON.stringify(it.payload_ref, null, 2) : ""
          };
          renderItems();
        }
      });
    });
  }

  function moveItem(id, delta) {
    const items = state.items.sort((a,b)=>Number(a.order)-Number(b.order));
    const i = items.findIndex(x => x.id === id);
    if (i < 0) return;
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    // swap orders em memória e renumera em seguida
    const oi = items[i].order;
    items[i].order = items[j].order;
    items[j].order = oi;
    // renum sequencial
    items.sort((a,b)=>Number(a.order)-Number(b.order))
         .forEach((x, idx) => x.order = idx + 1);
    state.items = items;
    markOrderDirty(true);
    renderItems();
  }

  async function saveOrder() {
    if (!state.moduleId) return setOut({ error:"moduleId ausente" });
    const itemIds = state.items
      .sort((a,b)=>Number(a.order)-Number(b.order))
      .map(x => x.id);
    const r = await apiSafe(`/api/admin/modules/${encodeURIComponent(state.moduleId)}/reorder`, {
      method:"PATCH",
      body: JSON.stringify({ itemIds })
    });
    setOut({ reorder: r });
    if (r.status === 200) {
      // atualizar orders retornados
      const ret = r.body?.items || [];
      const map = new Map(ret.map(x => [x.id, Number(x.order)]));
      state.items.forEach(x => { x.order = map.get(x.id) ?? x.order; });
      markOrderDirty(false);
      renderItems();
    }
  }

  async function loadItems() {
    const moduleId = String($("im-moduleId")?.value || "").trim();
    if (!moduleId) return setOut({ error:"Informe moduleId" });
    state.moduleId = moduleId;
    const r = await apiSafe(`/api/admin/modules/${encodeURIComponent(moduleId)}/items`);
    setOut({ listItems: r });
    if (r.status === 200) {
      const list = Array.isArray(r.body?.items) ? r.body.items : [];
      state.items = list.map(x => {
        const ref = (x.payload_ref ?? x.payloadRef);
        const payloadRaw = ref != null ? JSON.stringify(ref, null, 2) : "";
        return {
          id: x.id,
          type: x.type,
          order: Number(x.order),
          payload_ref: ref,
          __orig: {
            type: x.type,
            payloadRaw,
          }
        };
      });
      markOrderDirty(false);
      renderItems();
    }
  }

  async function deleteModule() {
    const moduleId = String($("im-moduleId")?.value || "").trim();
    if (!moduleId) return setOut({ error:"Informe moduleId" });
    if (!confirm("Excluir módulo (itens/quiz/questões/progress serão removidos)?")) return;
    const r = await apiSafe(`/api/admin/modules/${encodeURIComponent(moduleId)}`, { method:"DELETE" });
    setOut({ deleteModule: r });
    if (r.status === 200) {
      state.moduleId = null;
      state.items = [];
      renderItems();
    }
  }

  $("im-load-items")?.addEventListener("click", loadItems);
  $("im-delete-module")?.addEventListener("click", deleteModule);
  $("im-save-order")?.addEventListener("click", saveOrder);
})();
