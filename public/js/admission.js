 
  const $ = (id)=>document.getElementById(id);

  // View toggle (list/pipeline) — from your UI idea :contentReference[oaicite:2]{index=2}
  const state = { view: "list", selected: new Set() };

  function setView(v){
    state.view = v;
    document.querySelectorAll('#viewChips .chip').forEach(b=>b.classList.remove('active'));
    document.querySelector(`#viewChips .chip[data-view="${v}"]`)?.classList.add('active');
    $('view-list').style.display = v==='list' ? '' : 'none';
    $('view-pipeline').style.display = v==='pipeline' ? '' : 'none';
    $('panelTitle').textContent = v==='list' ? 'Applicants' : 'Pipeline';
    $('panelSub').textContent = v==='list'
      ? 'Search, screen, and process applications.'
      : 'Move applicants through stages (open full view to process).';
    syncBulk();
  }

  $('viewChips').addEventListener('click', (e)=>{
    const btn = e.target.closest('.chip');
    if(!btn) return;
    setView(btn.dataset.view);
  });

  // Bulk selection + bar
  function syncBulk(){
    $('selCount').textContent = state.selected.size;
    $('bulkbar').classList.toggle('show', state.selected.size>0 && state.view==='list');
    $('bulkIds').value = Array.from(state.selected).join(',');
  }

  const rowChecks = ()=> Array.from(document.querySelectorAll('.rowCheck'));

  $('checkAll')?.addEventListener('change', (e)=>{
    rowChecks().forEach(cb=>{
      cb.checked = e.target.checked;
      if(cb.checked) state.selected.add(cb.value);
      else state.selected.delete(cb.value);
    });
    syncBulk();
  });

  document.querySelector('tbody')?.addEventListener('change', (e)=>{
    if(!e.target.classList.contains('rowCheck')) return;
    if(e.target.checked) state.selected.add(e.target.value);
    else state.selected.delete(e.target.value);
    syncBulk();
  });

  $('bulkClear').addEventListener('click', ()=>{
    state.selected.clear();
    rowChecks().forEach(cb=> cb.checked=false);
    $('checkAll').checked = false;
    syncBulk();
  });

  // Bulk submit (posts to your controller bulkAction) :contentReference[oaicite:3]{index=3}
  $('bulkForm').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-act]');
    if(!btn) return;

    if(!state.selected.size) return;

    $('bulkAction').value = btn.dataset.act;
    $('bulkIds').value = Array.from(state.selected).join(',');

    // submit
    $('bulkForm').submit();
  });

  // Export CSV (simple client-side)
  $('btnExport').addEventListener('click', ()=>{
    const rows = [];
    const head = ["applicationId","name","email","phone","program","intake","status","createdAt"];
    rows.push(head.join(","));

    document.querySelectorAll('tr[data-id]').forEach(tr=>{
      const vals = [
        tr.dataset.app || "",
        tr.dataset.name || "",
        tr.dataset.email || "",
        tr.dataset.phone || "",
        tr.dataset.program || "",
        tr.dataset.intake || "",
        tr.dataset.status || "",
        tr.querySelector('td:nth-child(7)')?.innerText?.trim() || ""
      ].map(v => `"${String(v).replaceAll('"','""')}"`);
      rows.push(vals.join(","));
    });

    const blob = new Blob([rows.join("\n")], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "admissions.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  // Quick modal
  function openQuickFrom(el){
    const id = el.closest('[data-id]')?.dataset.id || el.dataset.id;
    const tr = el.closest('tr[data-id]') || document.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if(!tr) return;

    $('mTitle').textContent = `Applicant • ${tr.dataset.name || ""}`;
    const miss = tr.dataset.miss ? `Missing: ${tr.dataset.miss}` : "All required docs present";
    $('mBody').innerHTML = `
      <div class="strong">${tr.dataset.name || "—"}</div>
      <div class="muted">${tr.dataset.app || "—"} • ${tr.dataset.phone || ""} ${tr.dataset.email ? "• "+tr.dataset.email : ""}</div>
      <div class="muted">Program: ${tr.dataset.program || "—"}</div>
      <div class="muted">Intake: ${tr.dataset.intake || "—"}</div>
      <div class="muted">Status: ${tr.dataset.status || "—"}</div>
      <div class="muted" style="margin-top:8px">${miss}</div>
    `;

    $('mOpen').href = `/admin/admissions/applicants/${id}`;
    $('mAdmit').href = `/admin/admissions/applicants/${id}#admit`;

    $('mQuick').style.display = "flex";
  }

  function closeQuick(){ $('mQuick').style.display = "none"; }

  document.addEventListener('click', (e)=>{
    if(e.target.closest('.actQuick')) return openQuickFrom(e.target.closest('.actQuick'));
    if(e.target.closest('.pipeQuick')) return openQuickFrom(e.target.closest('.pipeQuick'));
  });

  $('mClose').addEventListener('click', closeQuick);
  $('mCancel').addEventListener('click', closeQuick);
  $('mQuick').addEventListener('click', (e)=>{ if(e.target.id==='mQuick') closeQuick(); });

  // Right-side buttons placeholders
  $('qReports').addEventListener('click', ()=>alert("Reports page next (we can build /admin/admissions/reports)."));
  $('qIntake').addEventListener('click', ()=>alert("Intake management next (we can build /admin/admissions/intakes)."));

  // Init
  setView("list");
  syncBulk();
