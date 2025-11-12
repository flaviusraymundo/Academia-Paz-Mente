const API_BASE = "/api";
const FN_BASE = "/.netlify/functions";

async function call(url, method="GET", body) {
  const token = document.getElementById("token").value.trim();
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  document.getElementById("out").textContent = `HTTP ${res.status}\n` + text;
  try { return JSON.parse(text); } catch { return text; }
}
document.getElementById("getJwt").addEventListener("click", async () => {
  const email = document.getElementById("email").value.trim();
  const r = await fetch(`${FN_BASE}/dev-jwt?email=${encodeURIComponent(email)}`);
  const data = await r.json();
  document.getElementById("token").value = data.token || "";
});

document.getElementById("catalog").onclick = async () => {
  const data = await call(`${API_BASE}/catalog`);
  if (data.courses && data.courses[0]) {
    document.getElementById("courseId").value = data.courses[0].id;
  }
};

document.getElementById("modules").onclick = async () => {
  const c = document.getElementById("courseId").value.trim();
  if (!c) return alert("Defina courseId");
  await call(`${API_BASE}/catalog/courses/${c}/modules`);
};

// Utilidades
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
async function api(path, init={}) {
  const headers = { ...(init.headers||{}) };
  const tok = readToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...init, headers, cache:"no-store" });
  const text = await res.text();
  let body = text; try { body = JSON.parse(text); } catch {}
  return { status: res.status, body };
}
const $ = (sel) => document.querySelector(sel);
function setText(el, v){ if (typeof v === "string") el.textContent = v; else el.textContent = JSON.stringify(v,null,2); }
function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }

// Navegação simples entre seções
function goto(section) {
  const map = { catalog:"#sec-catalog", course:"#sec-course", certs:"#sec-certs", debug:"#sec-debug" };
  for (const [k, sel] of Object.entries(map)) {
    const el = $(sel);
    if (!el) continue;
    if (k === section) show(el); else hide(el);
  }
}

async function loadCatalog() {
  const wrap = $("#catalog");
  wrap.innerHTML = "Carregando...";
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
      <h3 style="margin:0 0 6px 0">${c.title || c.slug || c.id}</h3>
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

async function loadCourse() {
  const cid = String($("#courseId").value||"").trim();
  if (!cid) { $("#courseOut").innerHTML = `<div class="card bad">Informe courseId</div>`; return; }
  $("#courseOut").innerHTML = "Carregando...";
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

  // bind
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

async function openQuiz(quizId) {
  if (!quizId) { alert("quizId ausente"); return; }
  const wrap = $("#courseOut");
  wrap.innerHTML = "Carregando quiz...";
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

async function openVideo(itemId, courseId, moduleId) {
  const wrap = $("#courseOut");
  wrap.innerHTML = "Carregando vídeo...";
  const { status, body } = await api(`/api/video/${encodeURIComponent(itemId)}/playback-token`, { method:"POST" });
  if (status !== 200) { setText(wrap, { status, body }); return; }
  const playbackId = body?.playbackId || "";
  const token = body?.token || null;
  const policy = body?.policy || "unknown";
  const host = document.createElement("div");
  host.className = "card";
  host.innerHTML = `
    <div class="muted">itemId: <code>${itemId}</code>, courseId: <code>${courseId}</code>, moduleId: <code>${moduleId}</code></div>
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

async function openText(itemId, courseId, moduleId) {
  const wrap = $("#courseOut");
  const host = document.createElement("div");
  host.className = "card";
  host.innerHTML = `
    <div class="muted">itemId: <code>${itemId}</code>, courseId: <code>${courseId}</code>, moduleId: <code>${moduleId}</code></div>
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

async function loadCerts() {
  const out = $("#certsOut");
  out.innerHTML = "Carregando...";
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
      <div>emitido em: ${new Date(c.issued_at).toLocaleString()}</div>
      <div><a href="${c.pdf_url}" target="_blank" rel="noreferrer">Abrir PDF</a></div>
      ${c.serial ? `<div>serial: <code>${c.serial}</code></div>` : ""}
    `;
    list.appendChild(card);
  }
  out.innerHTML = "";
  out.appendChild(list);
}

async function checkHints() {
  const hint = $("#hint");
  const tok = readToken();
  const msgs = [];
  if (!tok) msgs.push("Cole seu JWT no topo e clique em Salvar.");
  setText(hint, msgs.length ? msgs.join(" ") : "Pronto para uso.");
}

// Bind inicial
(function init(){
  // token
  $("#jwt").value = readToken();
  $("#btnSaveToken").addEventListener("click", ()=>{
    const ok = saveToken(String($("#jwt").value||"").trim());
    alert(ok ? "Token salvo." : "Falha ao salvar token.");
    checkHints();
  });

  // nav simples
  document.querySelectorAll('nav a[data-section]').forEach(a=>{
    a.addEventListener("click", (e)=>{
      e.preventDefault();
      const sec = a.getAttribute("data-section");
      goto(sec);
      if (sec === "catalog") loadCatalog();
      if (sec === "certs") loadCerts();
    });
  });

  // course
  $("#btnLoadCourse").addEventListener("click", loadCourse);

  // defaults
  checkHints();
  goto("catalog");
  loadCatalog();
})();
