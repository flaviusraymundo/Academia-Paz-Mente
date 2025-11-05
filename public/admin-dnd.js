(function(){
  const $ = (sel)=>document.querySelector(sel);
  const out = $('#out');
  const list = $('#list');
  const selCourse = $('#course');
  const selModule = $('#module');
  const btnLoad = $('#load');
  const btnSave = $('#save');

  const token = ()=> (localStorage.getItem('lms_jwt')||'').trim();
  const auth = ()=> token()? { Authorization:`Bearer ${token()}` } : {};
  const show = (obj)=> out.textContent = JSON.stringify(obj,null,2);

  async function api(path, init={}){
    const r = await fetch(path, { ...init, headers:{'Content-Type':'application/json', ...(init.headers||{}), ...auth() }});
    const bodyText = await r.text();
    let body = bodyText;
    try{ body = JSON.parse(bodyText); }catch{}
    return { status:r.status, body };
  }

  // Load courses for select
  async function loadCourses(){
    if(!token()){ show({status:401, body:{error:'no_token'}}); return; }
    const r = await api('/api/admin/courses/summary');
    if(r.status!==200){ show(r); return; }
    const courses = r.body.courses||[];
    selCourse.innerHTML = courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('');
  }

  // Load modules from /api/me/items (por curso)
  async function loadModules(){
    const courseId = selCourse.value;
    const r = await api(`/api/me/items?courseId=${courseId}`);
    if(r.status!==200){ show(r); return; }
    const mods = (r.body.items||[]).map(m=>({id:m.id, title:m.title}));
    selModule.innerHTML = mods.map(m=>`<option value="${m.id}">${m.title}</option>`).join('');
  }

  // Load items for module for DnD
  async function loadItems(){
    const moduleId = selModule.value;
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
  loadCourses().then(loadModules);
})();
