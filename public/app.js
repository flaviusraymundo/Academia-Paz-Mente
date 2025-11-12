// ===== Config =====
const API_BASE = ""; // vazio → usa caminho relativo ao mesmo host (backend)

// ===== Utilidades JWT / Fetch =====
function readToken() {
  try {
    return localStorage.getItem("jwt") ||
           localStorage.getItem("lms_jwt") ||
           localStorage.getItem("apm_jwt") ||
           "";
  } catch { return ""; }
}
function saveToken(v) {
  try {
    localStorage.setItem("jwt", v);
    localStorage.setItem("lms_jwt", v);
    localStorage.setItem("apm_jwt", v);
    return true;
  } catch { return false; }
}
async function api(path, init = {}) {
  const base = API_BASE.replace(/\/+$/,"");
  const url = base ? `${base}${path}` : path;
  const headers = { ...(init.headers||{}) };
  const tok = readToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  let res;
  let text;
  try {
    res = await fetch(url, { ...init, headers, cache: "no-store" });
    text = await res.text();
  } catch (e) {
    log(`FETCH ERROR ${url}\n${String(e)}`);
    return { status: 0, body: { error: "fetch_failed", detail: String(e) } };
  }
  let body = text;
  try { body = JSON.parse(text); } catch {}
  log(`HTTP ${res.status} ${url}\n${text.slice(0,500)}`);
  return { status: res.status, body };
}

// ===== DOM Helpers =====
const $ = (sel) => document.querySelector(sel);
function setText(el, v){
  if (!el) return;
  if (typeof v === "string") el.textContent = v;
  else el.textContent = JSON.stringify(v, null, 2);
}
function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }
function spinnerHtml(label=""){ return `<span class="spinner"></span> ${label}`; }

// ===== Logger =====
function log(msg) {
  const el = $("#log");
  if (!el) return;
  const time = new Date().toISOString();
  el.textContent = `[${time}] ${msg}\n` + el.textContent;
}

// ===== Navegação =====
function goto(section) {
  const map = { catalog:"#sec-catalog", course:"#sec-course", certs:"#sec-certs", debug:"#sec-debug" };
  for (const [k, sel] of Object.entries(map)) {
    const el = $(sel);
    if (!el) continue;
    if (k === section) show(el); else hide(el);
  }
  if (section === "debug") log("Entrou na seção Debug.");
}

// ===== Catálogo =====
async function loadCatalog() {
  const wrap = $("#catalog");
  wrap.innerHTML = spinnerHtml("Carregando catálogo...");
  const { status, body } = await api("/api/catalog");
  if (status !== 200) {
    wrap.innerHTML = `<pre class="card" style="grid-column:1/-1">${JSON.stringify({status,body},null,2)}</pre>`;
    return;
  }
  const items = body.items || body.courses || [];
  if (!Array.isArray(items) || items.length === 0) {
    wrap.innerHTML = `<div class="card muted" style="grid-column:1/-1">Nenhum curso encontrado.</div>`;
    return;
  }
  wrap.innerHTML = "";
  for (const c of items) {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <h3 style="margin:0 0 6px 0;font-size:15px">${c.title || c.slug || c.id}</h3>
      ${c.summary ? `<div class="muted" style="margin-bottom:8px">${c.summary}</div>` : ""}
      <div class="row">
        <button data-open-course="${c.id}" class="btn">Abrir curso</button>
      </div>
      <div class="muted" style="margin-top:6px">courseId: <code>${c.id}</code></div>
    `;
    wrap.appendChild(div);
  }
  wrap.querySelectorAll("[data-open-course]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      $("#courseId").value = btn.getAttribute("data-open-course");
      goto("course");
      $("#btnLoadCourse").click();
    });
  });
}

// ===== Curso / Módulos =====
async function loadCourse() {
  const cid = String($("#courseId").value||"").trim();
  if (!cid) { $("#courseOut").innerHTML = `<div class="card bad">Informe courseId</div>`; return; }
  $("#courseOut").innerHTML = spinnerHtml("Carregando módulos...");
  const { status, body } = await api(`/api/me/items?courseId=${encodeURIComponent(cid)}`);
  if (status !== 200) { setText($("#courseOut"), { status, body }); return; }
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) { $("#courseOut").innerHTML = `<div class="card muted">Curso sem módulos.</div>`; return; }

  const host = document.createElement("div");
  for (const m of items) {
    const box = document.createElement("div");
    box.className = "card";
    box.style.marginBottom = "10px";
    box.innerHTML = `
      <div><strong>${m.order}. ${m.title}</strong>
        <span class="pill ${m.unlocked?'ok':'bad'}">${m.unlocked?'desbloqueado':'bloqueado'}</span>
        <span class="pill">status: ${m.progress?.status || 'not_started'}</span>
      </div>
      <div class="muted">moduleId: <code>${m.id}</code></div>
      <div style="margin-top:8px"></div>
    `;
    const list = box.lastElementChild;
    for (const it of (m.items||[])) {
      const li = document.createElement("div");
      li.className = "card";
      li.style.margin = "6px 0";
      const type = String(it.type);
      const quizId = it?.payload_ref?.quiz_id || "";
      const playbackId = it?.payload_ref?.mux_playback_id || it?.payload_ref?.playback_id || "";
      const textMeta = it?.payload_ref?.doc_id ? `doc_id: ${it.payload_ref.doc_id}` : "";
      li.innerHTML = `
        <div><strong>${type.toUpperCase()}</strong> (order ${it.order})</div>
        <div class="muted">itemId: <code>${it.item_id}</code></div>
        <div class="row" style="margin-top:6px">
          ${type==="quiz" ? `<button class="btn" data-open-quiz="${quizId}">Abrir quiz</button>` : ""}
          ${type==="video" ? `<button class="btn" data-open-video="${it.item_id}" data-course="${cid}" data-module="${m.id}">Abrir vídeo</button>` : ""}
          ${type==="text" ? `<button class="btn" data-open-text="${it.item_id}" data-course="${cid}" data-module="${m.id}">Abrir texto</button>` : ""}
        </div>
        <div class="muted" style="margin-top:6px">
          ${type==="quiz" ? `quiz_id: <code>${quizId||"-"}</code>` : ""}
          ${type==="video" ? `playback_id: <code>${playbackId||"-"}</code>` : ""}
          ${type==="text" ? `${textMeta}` : ""}
        </div>
      `;
      list.appendChild(li);
    }
    host.appendChild(box);
  }
  $("#courseOut").innerHTML = "";
  $("#courseOut").appendChild(host);

  $("#courseOut").querySelectorAll("[data-open-quiz]").forEach(b=>{
    b.addEventListener("click", ()=> openQuiz(b.getAttribute("data-open-quiz")));
  });
  $("#courseOut").querySelectorAll("[data-open-video]").forEach(b=>{
    b.addEventListener("click", ()=> openVideo(
      b.getAttribute("data-open-video"),
      b.getAttribute("data-course"),
      b.getAttribute("data-module")
    ));
  });
  $("#courseOut").querySelectorAll("[data-open-text]").forEach(b=>{
    b.addEventListener("click", ()=> openText(
      b.getAttribute("data-open-text"),
      b.getAttribute("data-course"),
      b.getAttribute("data-module")
    ));
  });
}

// ===== Quiz =====
async function openQuiz(quizId) {
  if (!quizId) { alert("quizId ausente"); return; }
  const wrap = $("#courseOut");
  wrap.innerHTML = spinnerHtml("Carregando quiz...");
  const { status, body } = await api(`/api/quizzes/${encodeURIComponent(quizId)}`);
  if (status !== 200) { setText(wrap, { status, body }); return; }
  const quiz = body.quiz || {};
  const qs = Array.isArray(quiz.questions) ? quiz.questions : [];
  const host = document.createElement("div");
  host.className = "card";
  host.innerHTML = `<h3>Quiz</h3><div class="muted">quizId: <code>${quiz.id}</code>, passScore: ${quiz.passScore}</div>`;
  const form = document.createElement("div");
  for (const q of qs) {
    const div = document.createElement("div");
    div.className = "card";
    div.style.margin = "8px 0";
    div.innerHTML = `
      <div><strong>${q.kind || "single"}</strong></div>
      <div class="muted">questionId: <code>${q.id}</code></div>
      <div>prompt: <code>${JSON.stringify(q.body||{})}</code></div>
      <div>choices: <code>${JSON.stringify(q.choices||[])}</code></div>
      <div style="margin-top:6px"><input type="text" data-answer="${q.id}" placeholder='ex: ["A"]' style="width:100%"/></div>
    `;
    form.appendChild(div);
  }
  const actions = document.createElement("div");
  actions.className = "row";
  actions.innerHTML = `<button id="btnSubmitQuiz" class="btn">Enviar tentativa</button>`;
  host.appendChild(form);
  host.appendChild(actions);
  wrap.innerHTML = "";
  wrap.appendChild(host);

  $("#btnSubmitQuiz").addEventListener("click", async ()=>{
    const inputs = form.querySelectorAll("input[data-answer]");
    const answers = [];
    inputs.forEach((inp)=>{
      const id = inp.getAttribute("data-answer");
      let v = [];
      try { v = JSON.parse(inp.value || "[]"); } catch { v = []; }
      answers.push({ questionId: id, choiceIds: Array.isArray(v) ? v : [] });
    });
    const { status, body } = await api(`/api/quizzes/${encodeURIComponent(quizId)}/submit`, {
      method:"POST", body: JSON.stringify({ answers })
    });
    const out = document.createElement("pre");
    out.className = "card";
    setText(out, { status, body });
    host.appendChild(out);
  });
}

// ===== Vídeo =====
async function openVideo(itemId, courseId, moduleId) {
  const wrap = $("#courseOut");
  wrap.innerHTML = spinnerHtml("Carregando vídeo...");
  const { status, body } = await api(`/api/video/${encodeURIComponent(itemId)}/playback-token`, { method:"POST" });
  if (status !== 200) { setText(wrap, { status, body }); return; }
  const playbackId = body?.playbackId || "";
  const token = body?.token || null;
  const policy = body?.policy || "unknown";
  const host = document.createElement("div");
  host.className = "card";
  host.innerHTML = `
    <div class="muted">itemId: <code>${itemId}</code>, moduleId: <code>${moduleId}</code></div>
    <div class="muted">policy: ${policy}</div>
    <mux-player style="width:100%;max-width:960px;aspect-ratio:16/9;background:#000;display:block"
      stream-type="on-demand"
      playback-id="${playbackId}"
      ${token ? `playback-token="${token}"` : ""}
      muted autoplay preload="metadata">
    </mux-player>
    <div class="row" style="margin-top:8px">
      <button id="btnBeat" class="btn">Enviar heartbeat (15s)</button>
    </div>
    <pre id="beatOut" class="card" style="margin-top:10px"></pre>
  `;
  wrap.innerHTML = "";
  wrap.appendChild(host);

  $("#btnBeat").addEventListener("click", async ()=>{
    const { status, body } = await api(`/api/video/heartbeat`, {
      method:"POST",
      body: JSON.stringify({ courseId, moduleId, itemId, secs: 15 })
    });
    setText($("#beatOut"), { status, body });
  });
}

// ===== Texto =====
async function openText(itemId, courseId, moduleId) {
  const wrap = $("#courseOut");
  const host = document.createElement("div");
  host.className = "card";
  host.innerHTML = `
    <div class="muted">itemId: <code>${itemId}</code>, moduleId: <code>${moduleId}</code></div>
    <div class="row" style="margin-top:8px">
      <button id="btnPageRead" class="btn">Enviar page-read (15s)</button>
    </div>
    <pre id="textOut" class="card" style="margin-top:10px"></pre>
  `;
  wrap.innerHTML = "";
  wrap.appendChild(host);

  $("#btnPageRead").addEventListener("click", async ()=>{
    const { status, body } = await api(`/api/events/page-read`, {
      method:"POST",
      body: JSON.stringify({ courseId, moduleId, itemId, ms: 15000 })
    });
    setText($("#textOut"), { status, body });
  });
}

// ===== Certificados =====
async function loadCerts() {
  const out = $("#certsOut");
  out.innerHTML = spinnerHtml("Carregando certificados...");
  const { status, body } = await api(`/api/certificates?unique=1`);
  if (status !== 200) { setText(out, { status, body }); return; }
  const arr = Array.isArray(body.certificates) ? body.certificates : [];
  if (!arr.length) { out.innerHTML = `<div class="card muted">Nenhum certificado encontrado.</div>`; return; }
  const list = document.createElement("div");
  list.className = "grid";
  for (const c of arr) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div>courseId: <code>${c.course_id}</code></div>
      <div>emitido: ${new Date(c.issued_at).toLocaleString()}</div>
      <div><a href="${c.pdf_url}" target="_blank" rel="noreferrer">Abrir PDF</a></div>
      ${c.serial ? `<div>serial: <code>${c.serial}</code></div>` : ""}
    `;
    list.appendChild(card);
  }
  out.innerHTML = "";
  out.appendChild(list);
}

// ===== Health =====
async function health() {
  const { status, body } = await api("/api/health");
  log("Health response: " + JSON.stringify({status,body}));
  alert("Health status " + status);
}

// ===== Decode JWT =====
function decodeJwt() {
  const tok = readToken();
  if (!tok) { alert("Sem token"); return; }
  try {
    const parts = tok.split(".");
    if (parts.length < 2) throw new Error("Formato inválido");
    const payload = JSON.parse(atob(parts[1].replace(/-/g,"+").replace(/_/g,"/")));
    log("JWT payload:\n" + JSON.stringify(payload,null,2));
    alert("Email: " + (payload.email||"(sem)") + "\nsub: " + (payload.sub||"(sem)"));
  } catch (e) {
    alert("Falha ao decodificar: " + String(e));
  }
}

// ===== Hints =====
function checkHints() {
  const hint = $("#hint");
  const tok = readToken();
  const msgs = [];
  if (!tok) msgs.push("Cole seu JWT e clique em Salvar para destravar rotas protegidas.");
  msgs.push("API base: " + (API_BASE || "(mesmo host)"));
  setText(hint, msgs.join(" "));
}

// ===== Init =====
(function init(){
  window.addEventListener("error", (e)=>{
    log("JS ERROR: " + (e.message||String(e.error||e)));
  });

  $("#jwt").value = readToken();
  $("#btnSaveToken").addEventListener("click", ()=>{
    const ok = saveToken(String($("#jwt").value||"").trim());
    alert(ok ? "Token salvo." : "Falha ao salvar token.");
    checkHints();
  });
  $("#btnDecode").addEventListener("click", decodeJwt);
  $("#btnHealth").addEventListener("click", health);

  document.querySelectorAll('nav a[data-section]').forEach(a=>{
    a.addEventListener("click", (e)=>{
      e.preventDefault();
      const sec = a.getAttribute("data-section");
      goto(sec);
      if (sec === "catalog") loadCatalog();
      if (sec === "certs") loadCerts();
      if (sec === "debug") log("Entrou na aba Debug");
    });
  });

  $("#btnLoadCourse").addEventListener("click", loadCourse);

  checkHints();
  goto("catalog");
  loadCatalog();
})();
