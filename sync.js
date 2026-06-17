/* Đồng bộ sổ từ vựng lên Supabase (đăng nhập bằng email magic link).
   - Dữ liệu cá nhân: localStorage key "vocab_notebook_v1" (do on-tap.html dùng).
   - Mỗi user 1 dòng trong bảng "notebooks" (cột data jsonb).
   - Hợp nhất (merge) để KHÔNG mất dữ liệu khi dùng nhiều thiết bị:
     gộp theo từ; nếu trùng, giữ bản "đầy đủ hơn" (có ghi chú / đã thuộc).
*/
(function(){
  const LS = "vocab_notebook_v1";
  const bar = document.getElementById("syncBar");
  const URL = window.SUPABASE_URL, KEY = window.SUPABASE_ANON_KEY;
  const configured = URL && KEY && !/YOUR-/.test(URL) && !/YOUR-/.test(KEY);

  function box(html){ if(bar) bar.innerHTML =
    '<div style="border:1px solid #e5e7eb;background:#fff;border-radius:12px;padding:10px 12px;font-size:13px">'+html+'</div>'; }

  if(!window.supabase || !window.supabase.createClient){
    box('⚠️ Không tải được thư viện đồng bộ. Kiểm tra kết nối mạng.'); return;
  }
  if(!configured){
    box('☁️ <b>Đồng bộ đám mây chưa bật.</b> Mở file <code>supabase-config.js</code> và điền URL + anon key của Supabase. App vẫn dùng bình thường (dữ liệu lưu trên thiết bị này).');
    return;
  }

  const sb = window.supabase.createClient(URL, KEY);
  let busy=false, pushTimer=null;

  // ---- localStorage helpers ----
  const load = ()=>{ try{ return JSON.parse(localStorage.getItem(LS))||[]; }catch(e){ return []; } };
  const saveLocal = (arr)=> localStorage.setItem(LS, JSON.stringify(arr));

  // ---- merge: union theo từ, giữ bản đầy đủ hơn ----
  const keyOf = w => (w.word||"").trim().toLowerCase();
  function richness(w){ let r=0;
    if(w.known) r+=2;
    if(Array.isArray(w.unotes)) r+= w.unotes.filter(n=>n&&n.trim()).length;
    if(Array.isArray(w.uexs)) r+= w.uexs.filter(Boolean).length;
    if(w.meanings && w.meanings.length) r+=1;
    return r;
  }
  function merge(a,b){
    const m=new Map();
    (a||[]).concat(b||[]).forEach(w=>{ const k=keyOf(w); if(!k) return;
      const ex=m.get(k); if(!ex || richness(w)>richness(ex)) m.set(k,w); });
    return Array.from(m.values());
  }

  // ---- remote IO ----
  async function pull(){
    const { data, error } = await sb.from("notebooks").select("data").maybeSingle();
    if(error){ console.warn("pull error", error); return null; }
    return data ? data.data : null;
  }
  async function push(arr, uid){
    const { error } = await sb.from("notebooks")
      .upsert({ user_id: uid, data: arr, updated_at: new Date().toISOString() }, { onConflict:"user_id" });
    if(error) console.warn("push error", error);
    return !error;
  }

  function fmtTime(){ const d=new Date(); return d.getHours().toString().padStart(2,"0")+":"+d.getMinutes().toString().padStart(2,"0"); }

  // ---- sync (pull + merge + save + push) ----
  async function sync(uid, reload){
    if(busy) return; busy=true;
    try{
      const remote = await pull();
      const merged = merge(load(), remote);
      saveLocal(merged);
      await push(merged, uid);
      if(reload && window.reloadNotebook && !isEditing()) window.reloadNotebook();
      return merged.length;
    } finally { busy=false; }
  }
  function isEditing(){ const a=document.activeElement; return a && (a.tagName==="TEXTAREA" || a.tagName==="INPUT"); }

  // hook: mỗi lần app lưu → đẩy lên (gộp) sau 1.5s
  let curUid=null;
  window.afterSave = function(){
    if(!curUid) return;
    clearTimeout(pushTimer);
    pushTimer=setTimeout(()=>{ sync(curUid, true); }, 1500);
  };

  // ---- UI ----
  function renderSignedOut(){
    curUid=null;
    box('☁️ <b>Đồng bộ đám mây</b> — đăng nhập để lưu & dùng trên mọi thiết bị.'+
        '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">'+
        '<input id="syncEmail" type="email" inputmode="email" placeholder="email của bạn" '+
        'style="flex:1;min-width:160px;border:1px solid #e5e7eb;border-radius:8px;padding:7px 10px;font-size:14px">'+
        '<button id="syncSend" style="border:none;background:#7e57c2;color:#fff;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer">Gửi link đăng nhập</button>'+
        '</div><div id="syncMsg" style="font-size:12px;color:#6b7280;margin-top:6px"></div>');
    const btn=document.getElementById("syncSend"), inp=document.getElementById("syncEmail"), msg=document.getElementById("syncMsg");
    btn.onclick=async ()=>{
      const email=(inp.value||"").trim();
      if(!email){ msg.textContent="Nhập email trước nhé."; return; }
      btn.disabled=true; msg.textContent="Đang gửi…";
      const { error } = await sb.auth.signInWithOtp({ email, options:{ emailRedirectTo: location.href.split("#")[0] } });
      btn.disabled=false;
      msg.innerHTML = error ? ("❌ "+error.message) : "✅ Đã gửi link tới <b>"+email+"</b>. Mở email và bấm link để đăng nhập.";
    };
    inp.addEventListener("keydown",e=>{ if(e.key==="Enter") btn.click(); });
  }
  function renderSignedIn(user){
    curUid=user.id;
    box('🟢 <b>Đã đăng nhập:</b> '+user.email+
        ' <span id="syncState" style="color:#6b7280;font-size:12px"></span>'+
        '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">'+
        '<button id="syncNow" style="border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:7px 12px;font-weight:700;color:#7e57c2;cursor:pointer">🔄 Đồng bộ ngay</button>'+
        '<button id="syncOut" style="border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:7px 12px;cursor:pointer">Đăng xuất</button>'+
        '</div>');
    const st=document.getElementById("syncState");
    document.getElementById("syncNow").onclick=async ()=>{ st.textContent="(đang đồng bộ…)";
      const n=await sync(user.id, true); st.textContent="(đã đồng bộ "+(n||0)+" từ · "+fmtTime()+")"; };
    document.getElementById("syncOut").onclick=async ()=>{ await sb.auth.signOut(); };
    // đồng bộ ngay khi vào
    (async ()=>{ st.textContent="(đang đồng bộ…)"; const n=await sync(user.id, true); st.textContent="(đã đồng bộ "+(n||0)+" từ · "+fmtTime()+")"; })();
  }

  sb.auth.onAuthStateChange((_e, session)=>{
    if(session && session.user) renderSignedIn(session.user); else renderSignedOut();
  });
  sb.auth.getSession().then(({ data })=>{
    if(data.session && data.session.user) renderSignedIn(data.session.user); else renderSignedOut();
  });
})();
