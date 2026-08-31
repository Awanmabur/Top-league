(function () {
  const $ = (id) => document.getElementById(id);
  function openModal(id) { const el=$(id); if(el){el.classList.add("show");document.body.style.overflow="hidden";} }
  function closeModal(id) { const el=$(id); if(el) el.classList.remove("show"); if(!document.querySelector(".modal-backdrop.show")) document.body.style.overflow=""; }
  function decodeBook(btn) { try { return JSON.parse(decodeURIComponent(btn.dataset.book || "%7B%7D")); } catch { return {}; } }
  function postDynamic(action, fields) {
    const form=document.createElement("form"); form.method="POST"; form.action=action; form.hidden=true;
    const csrf=document.querySelector('input[name="_csrf"]')?.value || "";
    for (const [name,value] of Object.entries({_csrf:csrf,...fields})) { const input=document.createElement("input"); input.type="hidden"; input.name=name; input.value=value ?? ""; form.appendChild(input); }
    document.body.appendChild(form); form.submit();
  }
  document.querySelectorAll(".js-close-modal").forEach((btn)=>btn.addEventListener("click",()=>closeModal(btn.dataset.modal)));
  ["mBook","mViewBook","mAction","mBulk"].forEach((id)=>$(id)?.addEventListener("click",(e)=>{if(e.target===$(id))closeModal(id);}));
  document.addEventListener("keydown",(e)=>{if(e.key==="Escape")document.querySelectorAll(".modal-backdrop.show").forEach((el)=>el.classList.remove("show"));});

  const viewInput=$("viewInput");
  document.querySelectorAll("#viewChips .chip").forEach((btn)=>btn.addEventListener("click",function(){if(viewInput){viewInput.value=this.dataset.view;this.closest("form")?.submit();}}));
  const selected=new Set();
  function syncBulkbar(){if($("selCount"))$("selCount").textContent=selected.size; $("bulkbar")?.classList.toggle("show",selected.size>0 && (viewInput?.value||"catalog")==="catalog");}
  document.querySelectorAll(".rowCheck").forEach((box)=>box.addEventListener("change",function(){this.checked?selected.add(this.dataset.id):selected.delete(this.dataset.id);syncBulkbar();}));
  $("checkAll")?.addEventListener("change",function(){document.querySelectorAll(".rowCheck").forEach((box)=>{box.checked=this.checked;this.checked?selected.add(box.dataset.id):selected.delete(box.dataset.id);});syncBulkbar();});
  $("bulkClear")?.addEventListener("click",()=>{selected.clear();document.querySelectorAll(".rowCheck,#checkAll").forEach((el)=>el.checked=false);syncBulkbar();});
  function submitBulk(action){if(!selected.size)return alert("Select at least one book."); $("bulkIdsField").value=[...selected].join(","); $("bulkActionField").value=action; $("bulkCategoryField").value=$("bulkSetCategory")?.value||""; $("bulkStatusField").value=$("bulkSetStatus")?.value||""; $("bulkNoteField").value=$("bulkNote")?.value||""; $("bulkLibraryForm").submit();}
  $("btnBulk")?.addEventListener("click",()=>openModal("mBulk")); $("bulkCategory")?.addEventListener("click",()=>openModal("mBulk"));
  $("bulkMarkDamaged")?.addEventListener("click",()=>{if(confirm("Mark selected titles damaged? Active loans will be skipped."))submitBulk("damaged");});
  $("bulkArchive")?.addEventListener("click",()=>{if(confirm("Archive selected titles? Titles with active loans will be skipped."))submitBulk("archive");});
  $("applyBulkBtn")?.addEventListener("click",()=>submitBulk("update"));

  $("btnAddBook")?.addEventListener("click",()=>{ $("mBookTitle").textContent="Add Book"; $("bookForm").action="/admin/library/books"; ["bTitle","bAuthor","bIsbn","bPublisher","bShelf","bNotes"].forEach(id=>$(id).value=""); $("bCategory").value="Computer Science"; $("bYear").value=2020; $("bCopies").value=1; $("bAvailable").value=1; $("bStatus").value="Available"; openModal("mBook"); });
  document.querySelectorAll(".actEdit").forEach((btn)=>btn.addEventListener("click",function(){const b=decodeBook(this); $("mBookTitle").textContent="Edit Book"; $("bookForm").action=`/admin/library/books/${b._id}/update`; $("bTitle").value=b.title||"";$("bAuthor").value=b.author||"";$("bIsbn").value=b.isbn||"";$("bCategory").value=b.category||"Other";$("bPublisher").value=b.publisher||"";$("bYear").value=b.year||2020;$("bCopies").value=b.copies||1;$("bAvailable").value=b.available||0;$("bStatus").value=b.status||"Available";$("bShelf").value=b.shelf||"";$("bNotes").value=b.notes||"";openModal("mBook");}));
  document.querySelectorAll(".actView").forEach((btn)=>btn.addEventListener("click",function(){const b=decodeBook(this); for(const [id,val] of [["vTitle",b.title],["vAuthor",b.author],["vIsbn",b.isbn],["vCategory",b.category],["vPublisher",b.publisher],["vYear",b.year],["vCopies",b.copies],["vAvailable",b.available],["vStatus",b.status],["vShelf",b.shelf],["vNotes",b.notes||"No notes"]]) $(id).textContent=val??"—";openModal("mViewBook");}));

  $("btnImport")?.addEventListener("click",()=>$("libraryCsvFile")?.click());
  $("libraryCsvFile")?.addEventListener("change",function(){const file=this.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{if(!confirm(`Import ${file.name}? Existing ISBNs will be skipped.`))return;$("libraryCsvText").value=String(reader.result||"");$("libraryImportForm").submit();};reader.readAsText(file);});
  $("btnExport")?.addEventListener("click",()=>{const u=new URL(window.location.href);u.pathname="/admin/library/export.csv";u.searchParams.delete("view");window.location.href=u.pathname+u.search;});
  $("btnReports")?.addEventListener("click",()=>{window.location.href="/admin/library/report.csv";});
  $("btnQuickReturn")?.addEventListener("click",()=>{if(viewInput){viewInput.value="borrow";viewInput.closest("form")?.submit();}});
  $("btnAddCopy")?.addEventListener("click",()=>alert("Use the + button beside the exact catalogue title so inventory stays authoritative."));
  $("btnRecordPay")?.addEventListener("click",()=>alert("Use Pay beside the exact fine so the payment is applied to the correct record."));
  $("btnSetRate")?.addEventListener("click",()=>{const fine=prompt("Fine rate per overdue day (UGX)",$("libraryFineRate")?.value||"1000");if(fine===null)return;const days=prompt("Default loan period in days",$("libraryLoanDays")?.value||"14");if(days===null)return;const renewals=prompt("Maximum renewals per loan",$("libraryMaxRenewals")?.value||"1");if(renewals===null)return;$("libraryFineRate").value=fine;$("libraryLoanDays").value=days;$("libraryMaxRenewals").value=renewals;$("librarySettingsForm").submit();});

  function resetAction(mode,title,action){$("aStudent").disabled=false;$("aReg").disabled=false;$("mActionTitle").textContent=title;$("aMode").value=mode;$("actionForm").action=action;$("aStudent").value="";$("aReg").value="";$("aRef").value="";$("aAmount").value=0;$("aStatus").value=mode==="fine"?"Pending":"Active Hold";$("aType").value="Library Hold";$("aNote").value="";openModal("mAction");}
  $("btnCreateFine")?.addEventListener("click",()=>resetAction("fine","Create Fine","/admin/library/fines"));
  $("btnPlaceHold")?.addEventListener("click",()=>resetAction("hold","Place Hold","/admin/library/holds"));
  document.querySelectorAll(".brFine").forEach((btn)=>btn.addEventListener("click",function(){resetAction("fine","Create Fine",`/admin/library/books/${this.dataset.bookId}/fines`);$("aStudent").value=this.dataset.student||"";$("aReg").value=this.dataset.reg||"";$("aRef").value=this.dataset.ref||"";$("aAmount").value=5000;}));
  document.querySelectorAll(".fineHold").forEach((btn)=>btn.addEventListener("click",function(){resetAction("hold","Place Hold",this.dataset.bookId?`/admin/library/books/${this.dataset.bookId}/holds`:"/admin/library/holds");$("aStudent").value=this.dataset.student||"";$("aReg").value=this.dataset.reg||"";$("aRef").value=this.dataset.ref||"";}));
  document.querySelectorAll(".holdEdit").forEach((btn)=>btn.addEventListener("click",function(){resetAction("hold","Edit Hold",`/admin/library/holds/${this.dataset.holdId}/update`);$("aStudent").value=this.dataset.student||"";$("aStudent").disabled=true;$("aReg").value=this.dataset.reg||"";$("aReg").disabled=true;$("aRef").value=this.dataset.ref||"";$("aStatus").value=this.dataset.status||"Active Hold";}));
  syncBulkbar();
})();
