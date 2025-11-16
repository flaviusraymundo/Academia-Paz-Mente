(function ensureJwtHelpers(){
  // define/replace token() de forma tolerante
  try {
    // eslint-disable-next-line no-global-assign
    token = function token(){ // sobrescreve a existente, se houver no escopo global
      try {
        return (
          localStorage.getItem("apm_token") ||
          localStorage.getItem("lms_jwt") ||
          localStorage.getItem("jwt") ||
          localStorage.getItem("apm_jwt") ||
          ""
        );
      } catch { return ""; }
    };
  } catch {
    // se token não for atribuível (escopo fechado), cria um auxiliar global
    window.apmReadToken = function apmReadToken(){
      try {
        return (
          localStorage.getItem("apm_token") ||
          localStorage.getItem("lms_jwt") ||
          localStorage.getItem("jwt") ||
          localStorage.getItem("apm_jwt") ||
          ""
        );
      } catch { return ""; }
    };
  }

  // Banner opcional: aparece se não houver JWT; permite colar e salvar nas 3 chaves
  try {
    const read = (typeof token === "function" ? token : window.apmReadToken) || (() => "");
    if (read()) return; // já tem token
    const id = "apm-jwt-banner";
    if (document.getElementById(id)) return;

    const bar = document.createElement("div");
    bar.id = id;
    bar.style.cssText = "position:fixed;inset:auto 0 0 0;display:flex;gap:8px;align-items:center;padding:10px 12px;background:#fff7d6;border-top:1px solid #ffe08a;z-index:9999;font:13px system-ui,sans-serif";
    bar.innerHTML = `
      <strong style="color:#8a6d3b">JWT:</strong>
      <input id="apm-jwt-input" placeholder="Cole seu JWT aqui" style="flex:1;padding:6px 8px;font-family:monospace;border:1px solid #ddd;border-radius:6px"/>
      <button id="apm-jwt-save" style="padding:6px 10px;border:1px solid #ccc;border-radius:6px;background:#fff">Salvar</button>
      <button id="apm-jwt-dismiss" style="padding:6px 10px;border:1px solid #ccc;border-radius:6px;background:#fff">Fechar</button>
    `;
    document.body.appendChild(bar);

    const $ = (sel) => document.querySelector(sel);
    $("#apm-jwt-save")?.addEventListener("click", ()=>{
      const v = String($("#apm-jwt-input")?.value || "").trim();
      if (!v) return;
      try {
        localStorage.setItem("apm_token", v);
        localStorage.setItem("lms_jwt", v);
        localStorage.setItem("jwt", v);
        localStorage.setItem("apm_jwt", v);
        location.reload();
      } catch {
        alert("Falha ao salvar JWT no localStorage.");
      }
    });
    $("#apm-jwt-dismiss")?.addEventListener("click", ()=> bar.remove());
  } catch {}
})();

(function(){
  // Executa apenas na página específica (evita rodar por engano em outras telas)
  if (!window.location.pathname.endsWith('/admin-dnd.html')) return;

  const $ = (sel)=>document.querySelector(sel);
  const out = $('#out');
  const list = $('#list');
  const selCourse = $('#course');
  const selModule = $('#module');
  const btnLoad = $('#load');
  const btnSave = $('#save');

  function readJwt(){
    const read = (typeof token === 'function' ? token : window.apmReadToken) || (()=> '');
    let value = '';
    try {
      value = String(read() || '').trim();
    } catch {}
    if (!value) value = ($('#jwt')?.value || '').trim();
    try {
      const parsed = JSON.parse(value);
      if (parsed && parsed.token) value = String(parsed.token);
    } catch {}
    return value.trim();
  }

  const show = (obj)=> out.textContent = JSON.stringify(obj,null,2);
  const isUuid = (s)=> /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s||'');

  function ensureToken(){
    if (!readJwt()){
      show({status:401, body:{error:'no_token', hint:'Defina localStorage.apm_token (ou preencha o campo #jwt) e recarregue'}});
      btnLoad.disabled = true;
      btnSave.disabled = true;
      return false;
    }
    btnLoad.disabled = false;
    return true;
  }

  async function api(path, init={}){
    const jwt = readJwt();
    const headers = { ...(init.headers||{}) };
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
    if (init.body && !('Content-Type' in headers)) headers['Content-Type'] = 'application/json';
    const r = await fetch(path, { ...init, headers });
    const bodyText = await r.text();
    let body = bodyText;
    try{ body = JSON.parse(bodyText); }catch{}
    return { status:r.status, body };
  }

  // cursos para o select (rota protegida)
  async function loadCourses(){
    if(!ensureToken()) return;
    const r = await api('/api/admin/courses/_summary');
    if(r.status!==200){ show(r); return; }
    const courses = r.body.courses||[];
    selCourse.innerHTML = '';
    for (const c of courses){
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.title;
      selCourse.appendChild(opt);
    }
    if (selCourse.options.length > 0) selCourse.selectedIndex = 0;
  }

  // Load modules from /api/me/items (por curso)
  async function loadModules(){
    selModule.innerHTML = '';
    const courseId = selCourse.value;
    if (!isUuid(courseId)){ show({status:400, body:{error:'choose_course'}}); return; }
    const r = await api(`/api/me/items?courseId=${courseId}`);
    if(r.status!==200){ show(r); return; }
    const mods = (r.body.items||[]).map(m=>({id:m.id, title:m.title}));
    for (const m of mods){
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.title;
      selModule.appendChild(opt);
    }
    if (selModule.options.length > 0) selModule.selectedIndex = 0;
  }

  // Load items for module for DnD
  async function loadItems(){
    const moduleId = selModule.value;
    if (!isUuid(moduleId)) { show({status:400, body:{error:'choose_module'}}); return; }
    const r = await api(`/api/admin/modules/${moduleId}/items`);
    if(r.status!==200){ show(r); return; }
    const items = r.body.items||[];
    list.innerHTML = items
      .sort((a,b)=>a.order-b.order)
      .map(it=>`
        <li class="row" draggable="true" data-id="${it.id}">
          <span class="handle">⋮⋮</span>
          <span>${it.order}.</span>
          <span class="type">${it.type.toUpperCase()}</span>
          <span>${it.id}</span>
        </li>`).join('');
    attachDnD();
    btnSave.disabled = items.length===0;
    show({status:r.status, count:items.length});
  }

  // Simple HTML5 DnD
  function attachDnD(){
    let dragEl=null;
    list.querySelectorAll('.row').forEach(li=>{
      li.addEventListener('dragstart', e=>{ dragEl=li; li.classList.add('ghost'); e.dataTransfer.setData('text/plain', li.dataset.id); });
      li.addEventListener('dragend',   ()=>{ if(dragEl) dragEl.classList.remove('ghost'); dragEl=null; });
      li.addEventListener('dragover',  e=>{ e.preventDefault(); });
      li.addEventListener('drop',      e=>{
        e.preventDefault();
        const target = e.currentTarget;
        if(!dragEl || dragEl===target) return;
        const rect = target.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height/2;
        list.insertBefore(dragEl, before? target : target.nextSibling);
        renumber();
      });
    });
  }

  function renumber(){
    [...list.children].forEach((li,idx)=>{
      li.querySelectorAll('span')[1].textContent = (idx+1)+'.';
    });
  }

  async function saveOrder(){
    const moduleId = selModule.value;
    const ids = [...list.children].map(li=>li.dataset.id);
    const r = await api(`/api/admin/modules/${moduleId}/reorder`, {
      method:'PATCH',
      body: JSON.stringify({ itemIds: ids })
    });
    show(r);
  }

  btnLoad.addEventListener('click', loadItems);
  btnSave.addEventListener('click', saveOrder);
  selCourse.addEventListener('change', loadModules);

  // bootstrap
  (function(){
    const tok = readJwt();
    if (!tok || tok.split('.').length !== 3) console.warn('JWT ausente ou inválido');
  })();
  ensureToken() && loadCourses().then(loadModules);
})();
