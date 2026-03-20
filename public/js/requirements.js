 
  // NO external script tag => avoids /js/requirements 404 + MIME issues

  var mBack = document.getElementById("mBack");
  var btnNew = document.getElementById("btnNew");
  var mClose = document.getElementById("mClose");
  var mTitle = document.getElementById("mTitle");
  var mForm = document.getElementById("mForm");

  function openModal(){ if(mBack) mBack.style.display = "flex"; }
  function closeModal(){ if(mBack) mBack.style.display = "none"; }

  function setMulti(sel, values){
    if(!sel) return;
    var set = {};
    (values||[]).forEach(function(v){ set[String(v)] = true; });
    Array.from(sel.options).forEach(function(o){ o.selected = !!set[String(o.value)]; });
  }

  function toggleMulti(){
    var pAllEl = document.getElementById("fPAll");
    var iAllEl = document.getElementById("fIAll");
    var pSel = document.getElementById("fPrograms");
    var iSel = document.getElementById("fIntakes");

    var pAll = pAllEl ? pAllEl.checked : false;
    var iAll = iAllEl ? iAllEl.checked : false;

    if(pSel) pSel.disabled = pAll;
    if(iSel) iSel.disabled = iAll;
  }

  if(btnNew){
    btnNew.addEventListener("click", function(){
      mTitle.textContent = "Add Requirement";
      mForm.action = "/admin/admissions/requirements";

      document.getElementById("fTitle").value = "";
      document.getElementById("fCode").value = "";
      document.getElementById("fCategory").value = "document";
      document.getElementById("fDesc").value = "";
      document.getElementById("fSort").value = "0";
      document.getElementById("fMand").checked = true;
      document.getElementById("fActive").checked = true;

      document.getElementById("fPAll").checked = true;
      document.getElementById("fIAll").checked = true;

      setMulti(document.getElementById("fPrograms"), []);
      setMulti(document.getElementById("fIntakes"), []);
      toggleMulti();
      openModal();
    });
  }

  document.addEventListener("click", function(e){
    var btn = e.target.closest("[data-edit]");
    if(!btn) return;

    var tr = btn.closest("tr[data-id]");
    if(!tr) return;

    mTitle.textContent = "Edit Requirement";
    mForm.action = "/admin/admissions/requirements/" + tr.dataset.id;

    document.getElementById("fTitle").value = tr.dataset.title || "";
    document.getElementById("fCode").value = tr.dataset.code || "";
    document.getElementById("fCategory").value = tr.dataset.category || "document";
    document.getElementById("fDesc").value = tr.dataset.description || "";
    document.getElementById("fSort").value = tr.dataset.sort || "0";
    document.getElementById("fMand").checked = (tr.dataset.mand === "true");
    document.getElementById("fActive").checked = (tr.dataset.active === "true");

    document.getElementById("fPAll").checked = (tr.dataset.pall === "true");
    document.getElementById("fIAll").checked = (tr.dataset.iall === "true");

    var p = []; var i = [];
    try { p = JSON.parse(tr.dataset.programs || "[]"); } catch(err) {}
    try { i = JSON.parse(tr.dataset.intakes || "[]"); } catch(err) {}

    setMulti(document.getElementById("fPrograms"), p);
    setMulti(document.getElementById("fIntakes"), i);
    toggleMulti();
    openModal();
  });

  var fPAll = document.getElementById("fPAll");
  var fIAll = document.getElementById("fIAll");
  if(fPAll) fPAll.addEventListener("change", toggleMulti);
  if(fIAll) fIAll.addEventListener("change", toggleMulti);

  if(mClose) mClose.addEventListener("click", closeModal);
  if(mBack){
    mBack.addEventListener("click", function(e){
      if(e.target === mBack) closeModal();
    });
  }

  document.addEventListener("keydown", function(e){
    if(e.key === "Escape") closeModal();
  });
