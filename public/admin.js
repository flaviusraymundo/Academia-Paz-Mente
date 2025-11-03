function authHeaders() {
  const t = document.getElementById("jwt").value.trim();
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}
async function req(path, method="GET", body) {
  const r = await fetch(`/api${path}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; } catch { return { status: r.status, data: text }; }
}
function out(el, x) { document.getElementById(el).textContent = typeof x==="string" ? x : JSON.stringify(x, null, 2); }

document.getElementById("ping").onclick = async () => {
  const res = await fetch("/api/health");
  out("out", `HTTP ${res.status} ${await res.text()}`);
};

document.getElementById("listCourses").onclick = async () => {
  const r = await req("/admin/courses");
  out("listOut", r);
};
document.getElementById("listTracks").onclick = async () => {
  const r = await req("/catalog"); // lista pública com tracks e courses
  out("listOut", r);
};

document.getElementById("createCourse").onclick = async () => {
  const body = {
    slug: document.getElementById("c-slug").value.trim(),
    title: document.getElementById("c-title").value.trim(),
    summary: document.getElementById("c-summary").value.trim(),
    level: document.getElementById("c-level").value.trim() || "beginner",
    active: document.getElementById("c-active").checked
  };
  const r = await req("/admin/courses", "POST", body);
  out("listOut", r);
};

document.getElementById("createModule").onclick = async () => {
  const body = {
    courseId: document.getElementById("m-course").value.trim(),
    title: document.getElementById("m-title").value.trim(),
    order: Number(document.getElementById("m-order").value || 0),
  };
  const r = await req("/admin/modules", "POST", body);
  out("listOut", r);
};

document.getElementById("createItem").onclick = async () => {
  let payload = {};
  const raw = document.getElementById("i-payload").value.trim();
  if (raw) { try { payload = JSON.parse(raw); } catch { alert("payload_ref inválido"); return; } }
  const body = {
    moduleId: document.getElementById("i-module").value.trim(),
    type: document.getElementById("i-type").value,
    order: Number(document.getElementById("i-order").value || 0),
    payloadRef: payload,
  };
  const r = await req("/admin/items", "POST", body);
  out("listOut", r);
};

document.getElementById("createQuiz").onclick = async () => {
  const body = {
    moduleId: document.getElementById("q-module").value.trim(),
    passScore: Number(document.getElementById("q-pass").value || 70),
  };
  const r = await req("/admin/quizzes", "POST", body);
  out("listOut", r);
};

document.getElementById("addQuestion").onclick = async () => {
  let bodyJson = {}, choicesJson = [], answerJson = [];
  const b = document.getElementById("qq-body").value.trim();
  const c = document.getElementById("qq-choices").value.trim();
  const a = document.getElementById("qq-answer").value.trim();
  try { bodyJson = b ? JSON.parse(b) : {}; } catch { alert("body inválido"); return; }
  try { choicesJson = c ? JSON.parse(c) : []; } catch { alert("choices inválido"); return; }
  try { answerJson = a ? JSON.parse(a) : []; } catch { alert("answerKey inválido"); return; }

  const body = {
    quizId: document.getElementById("qq-quiz").value.trim(),
    kind: document.getElementById("qq-kind").value,
    body: bodyJson,
    choices: choicesJson,
    answerKey: answerJson
  };
  const r = await req("/admin/questions", "POST", body);
  out("listOut", r);
};

document.getElementById("createTrack").onclick = async () => {
  const body = {
    slug: document.getElementById("t-slug").value.trim(),
    title: document.getElementById("t-title").value.trim(),
    active: document.getElementById("t-active").checked
  };
  const r = await req("/admin/tracks", "POST", body);
  out("listOut", r);
};

document.getElementById("addTrackCourse").onclick = async () => {
  const body = {
    trackId: document.getElementById("tc-track").value.trim(),
    courseId: document.getElementById("tc-course").value.trim(),
    order: Number(document.getElementById("tc-order").value || 0),
    required: document.getElementById("tc-required").checked
  };
  const r = await req("/admin/track-courses", "POST", body);
  out("listOut", r);
};

document.getElementById("addPrereq").onclick = async () => {
  const body = {
    courseId: document.getElementById("p-course").value.trim(),
    requiredCourseId: document.getElementById("p-req").value.trim()
  };
  const r = await req("/admin/prerequisites", "POST", body);
  out("listOut", r);
};
