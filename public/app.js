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

document.getElementById("getJwt").onclick = async () => {
  const email = document.getElementById("email").value.trim();
  const data = await call(`//.netlify/functions/dev-jwt?email=${encodeURIComponent(email)}`);
  if (data.token) document.getElementById("token").value = data.token;
};

document.getElementById("catalog").onclick = async () => {
  const data = await call("/api/catalog");
  if (data.courses && data.courses[0]) {
    document.getElementById("courseId").value = data.courses[0].id;
  }
};

document.getElementById("modules").onclick = async () => {
  const c = document.getElementById("courseId").value.trim();
  if (!c) return alert("Defina courseId");
  await call(`/api/catalog/courses/${c}/modules`);
};
