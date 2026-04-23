(() => {
  const form = document.getElementById("applyForm");
  if (!form) return;
  const byId = (id) => document.getElementById(id);
  const btnDraft = byId("btnDraft");
  const btnReset = byId("btnReset");
  const btnNew = byId("btnNew");
  const dropZone = byId("dropZone");
  const quickFiles = byId("quickFiles");
  const pickQuick = byId("pickQuick");
  const fileList = byId("fileList");
  const otherDocsInput = byId("otherDocs") || form.querySelector('input[name="otherDocs"]');
  const passportPhoto = byId("passportPhoto");
  const idDocument = byId("idDocument");
  const transcript = byId("transcript");
  const submitStatus = byId("submitStatus");
  const schoolLevel = byId("schoolLevel");
  const classLevel = byId("classLevel");
  const streamId = byId("streamId");
  const section1 = byId("section1");
  const qualification = byId("qualification");
  const school = byId("school");
  const yearCompleted = byId("yearCompleted");
  const termId = byId("termId");
  const academicYear = byId("academicYear");
  const uploadDraftUrl = byId("uploadDraftUrl")?.value || "/admissions/upload-draft";
  const applyActionUrl = byId("applyActionUrl")?.value || "/admissions/apply";
  const csrfToken = form.querySelector('input[name="_csrf"]')?.value || "";
  const selectedSchoolUnitId = form.querySelector('input[name="schoolUnitId"]')?.value || "";
  const DRAFT_KEY = selectedSchoolUnitId
    ? `classic_academy_apply_draft_v3_unit_${selectedSchoolUnitId}`
    : "classic_academy_apply_draft_v3";
  const uploadPromises = new Set();

  function readJson(id, fallback) {
    const el = byId(id);
    if (!el) return fallback;
    try { return JSON.parse(el.value || "null") || fallback; } catch (_) { return fallback; }
  }
  const streams = readJson("streamsData", []);
  const sections = readJson("sectionsData", []);
  const qualificationMap = readJson("qualificationMapData", {});
  let storedUploads = readJson("storedUploadsData", { passportPhoto: null, idDocument: null, transcript: null, otherDocs: [] });

  const classMap = {
    nursery: ["BABY", "MIDDLE", "TOP"],
    primary: ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"],
    secondary: ["S1", "S2", "S3", "S4", "S5", "S6"],
  };

  const humanSize = (bytes) => {
    const units = ["B", "KB", "MB", "GB"];
    let i = 0; let n = Number(bytes || 0);
    while (n > 1024 && i < units.length - 1) { n /= 1024; i += 1; }
    return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  };
  const escapeHtml = (str) => String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function refillSelect(select, options, selected, placeholder) {
    if (!select) return;
    const current = selected != null ? String(selected) : String(select.value || "");
    select.innerHTML = `<option value="">${placeholder || "Select"}</option>` + options.map((opt) => `<option value="${escapeHtml(opt.value)}" ${String(opt.value) === current ? "selected" : ""}>${escapeHtml(opt.label)}</option>`).join("");
  }

  function setStatus(id, text, tone) {
    const el = byId(id);
    if (!el) return;
    el.className = "hint";
    if (!text) { el.textContent = ""; return; }
    if (tone === "error") el.style.color = "#b91c1c";
    else if (tone === "ok") el.style.color = "#15803d";
    else el.style.color = "";
    el.textContent = text;
  }

  function refreshUploadUi() {
    if (passportPhoto) {
      passportPhoto.required = !storedUploads.passportPhoto;
      setStatus("passportPhotoStatus", storedUploads.passportPhoto ? `Saved: ${storedUploads.passportPhoto.originalName || "Passport Photo"}` : "Not uploaded yet", storedUploads.passportPhoto ? "ok" : "");
    }
    if (idDocument) {
      idDocument.required = !storedUploads.idDocument;
      setStatus("idDocumentStatus", storedUploads.idDocument ? `Saved: ${storedUploads.idDocument.originalName || "ID Document"}` : "Not uploaded yet", storedUploads.idDocument ? "ok" : "");
    }
    const noPrev = String(qualification?.value || "").toLowerCase() === "no previous education";
    if (transcript) {
      transcript.required = !noPrev && !storedUploads.transcript;
      const msg = noPrev ? "Not required for no previous education" : (storedUploads.transcript ? `Saved: ${storedUploads.transcript.originalName || "Transcript"}` : "Not uploaded yet");
      setStatus("transcriptStatus", msg, storedUploads.transcript || noPrev ? "ok" : "");
    }
    setStatus("otherDocsStatus", Array.isArray(storedUploads.otherDocs) && storedUploads.otherDocs.length ? `${storedUploads.otherDocs.length} extra document(s) saved` : "Optional", Array.isArray(storedUploads.otherDocs) && storedUploads.otherDocs.length ? "ok" : "");
    renderOtherDocs();
  }

  function syncAcademicYear() {
    if (!termId || !academicYear) return;
    const selected = termId.options[termId.selectedIndex];
    const year = selected ? String(selected.getAttribute("data-year") || "").trim() : "";
    academicYear.innerHTML = `<option value="">Select</option>`;
    if (!year) { academicYear.value = ""; academicYear.disabled = true; return; }
    academicYear.disabled = false;
    const opt = document.createElement("option");
    opt.value = year;
    opt.textContent = year;
    opt.selected = true;
    academicYear.appendChild(opt);
    academicYear.value = year;
  }

  function syncClassLevels() {
    if (!schoolLevel || !classLevel) return;
    const allowed = classMap[String(schoolLevel.value || "").toLowerCase()] || [];
    refillSelect(classLevel, allowed.map((x) => ({ value: x, label: x })), classLevel.value, "Select");
  }

  function syncStreams() {
    if (!streamId) return;
    const level = String(schoolLevel?.value || "").toLowerCase();
    const klass = String(classLevel?.value || "").toUpperCase();
    const opts = streams.filter((s) => (!level || s.levelType === level) && (!klass || s.classLevel === klass)).map((s) => ({ value: s._id, label: s.name }));
    refillSelect(streamId, opts, streamId.value, "Select stream");
  }

  function syncSections() {
    if (!section1) return;
    const level = String(schoolLevel?.value || "").toLowerCase();
    const klass = String(classLevel?.value || "").toUpperCase();
    const selectedStream = streams.find((s) => String(s._id) === String(streamId?.value || ""));
    const classId = selectedStream ? String(selectedStream.classId || "") : "";

    let filtered = sections.filter((s) =>
      (!level || s.levelType === level) &&
      (!klass || s.classLevel === klass) &&
      (!classId || String(s.classId || "") === classId)
    );
    if (!filtered.length) {
      filtered = sections.filter((s) => (!level || s.levelType === level) && (!klass || s.classLevel === klass));
    }
    const opts = filtered.map((s) => ({ value: s._id, label: s.name }));
    const selectedStillExists = opts.some((opt) => String(opt.value) === String(section1.value || ""));
    refillSelect(section1, opts, selectedStillExists ? section1.value : "", "Select section");
    section1.disabled = !opts.length;
  }

  function syncQualifications() {
    const level = String(schoolLevel?.value || "").toLowerCase();
    const opts = Array.isArray(qualificationMap[level]) ? qualificationMap[level] : [];
    refillSelect(qualification, opts.map((x) => ({ value: x, label: x })), qualification?.value || "", "Select");
    syncEducationFields();
  }

  function syncEducationFields() {
    const q = String(qualification?.value || "").toLowerCase();
    const noPrev = q === "no previous education";
    if (school) { school.disabled = noPrev; school.required = !noPrev; if (noPrev) school.value = ""; }
    if (yearCompleted) { yearCompleted.disabled = noPrev; yearCompleted.required = !noPrev; if (noPrev) yearCompleted.value = ""; }
    if (transcript) transcript.required = !noPrev && !storedUploads.transcript;
    refreshUploadUi();
  }

  function renderOtherDocs() {
    if (!fileList) return;
    const queued = otherDocsInput && otherDocsInput.files ? Array.from(otherDocsInput.files) : [];
    const saved = Array.isArray(storedUploads.otherDocs) ? storedUploads.otherDocs : [];
    const parts = [];
    saved.forEach((f) => {
      parts.push(`<div class="file"><div style="display:flex;gap:10px;align-items:center"><i class="fa-solid fa-file-circle-check"></i><div><div class="name">${escapeHtml(f.originalName || "Saved document")}</div><div class="muted">${humanSize(f.bytes)} • ${escapeHtml(f.mimeType || "file")}</div></div></div><span class="badge ok"><i class="fa-solid fa-check"></i> saved</span></div>`);
    });
    queued.forEach((f) => {
      parts.push(`<div class="file"><div style="display:flex;gap:10px;align-items:center"><i class="fa-solid fa-file"></i><div><div class="name">${escapeHtml(f.name)}</div><div class="muted">${humanSize(f.size)} • ${escapeHtml(f.type || "file")}</div></div></div><span class="badge warn"><i class="fa-solid fa-arrow-up"></i> pending</span></div>`);
    });
    fileList.innerHTML = parts.length ? parts.join("") : `<div class="muted">No extra files selected yet.</div>`;
  }

  function mergeIntoOtherDocs(newFiles) {
    if (!otherDocsInput) return;
    const dt = new DataTransfer();
    const existing = otherDocsInput.files ? Array.from(otherDocsInput.files) : [];
    [...existing, ...newFiles].forEach((f) => dt.items.add(f));
    otherDocsInput.files = dt.files;
    renderOtherDocs();
    queueUpload("otherDocs", otherDocsInput.files);
  }

  async function uploadFiles(fieldName, files) {
    const fileArr = Array.from(files || []);
    if (!fileArr.length) return;
    if (submitStatus) submitStatus.textContent = `Uploading ${fieldName === "otherDocs" ? "documents" : "file"}...`;
    const fd = new FormData();
    if (csrfToken) fd.append("_csrf", csrfToken);
    fileArr.forEach((f) => fd.append(fieldName, f));
    const res = await fetch(uploadDraftUrl, {
      method: "POST",
      body: fd,
      headers: { "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.message || "Upload failed");
    storedUploads = data.uploads || storedUploads;
    if (fieldName !== "otherDocs") {
      const input = form.querySelector(`[name="${fieldName}"]`);
      if (input) input.value = "";
    } else if (otherDocsInput) {
      otherDocsInput.value = "";
    }
    if (quickFiles) quickFiles.value = "";
    refreshUploadUi();
    if (submitStatus) submitStatus.textContent = "Documents saved automatically.";
  }

  function queueUpload(fieldName, files) {
    const fileArr = Array.from(files || []);
    if (!fileArr.length) return Promise.resolve();
    const p = uploadFiles(fieldName, fileArr)
      .catch((err) => {
        refreshUploadUi();
        const targetStatus = `${fieldName}Status`;
        setStatus(targetStatus, err.message || "Upload failed", "error");
        if (submitStatus) submitStatus.textContent = err.message || "Upload failed";
        throw err;
      })
      .finally(() => uploadPromises.delete(p));
    uploadPromises.add(p);
    return p;
  }

  if (dropZone && quickFiles && pickQuick) {
    const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/jpg", "image/webp"]);
    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag");
      const list = Array.from(e.dataTransfer.files || []).filter((f) => allowed.has(f.type) || /\.(pdf|jpg|jpeg|png|webp)$/i.test(f.name || ""));
      if (list.length) mergeIntoOtherDocs(list);
    });
    pickQuick.addEventListener("click", () => quickFiles.click());
    quickFiles.addEventListener("change", () => {
      const list = Array.from(quickFiles.files || []).filter((f) => allowed.has(f.type) || /\.(pdf|jpg|jpeg|png|webp)$/i.test(f.name || ""));
      if (list.length) mergeIntoOtherDocs(list);
      quickFiles.value = "";
    });
  }

  passportPhoto?.addEventListener("change", () => queueUpload("passportPhoto", passportPhoto.files));
  idDocument?.addEventListener("change", () => queueUpload("idDocument", idDocument.files));
  transcript?.addEventListener("change", () => queueUpload("transcript", transcript.files));
  otherDocsInput?.addEventListener("change", () => queueUpload("otherDocs", otherDocsInput.files));

  const getDraft = () => {
    const data = {};
    const fd = new FormData(form);
    fd.forEach((v, k) => {
      if (v instanceof File) return;
      if (data[k] !== undefined) {
        if (!Array.isArray(data[k])) data[k] = [data[k]];
        data[k].push(v);
      } else data[k] = v;
    });
    return data;
  };

  const saveDraft = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(getDraft())); } catch (_) {} };
  const loadDraft = () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      Object.keys(data).forEach((k) => {
        const els = form.querySelectorAll(`[name="${CSS.escape(k)}"]`);
        if (!els.length) return;
        const el = els[0];
        if (!el) return;
        if (el.type === "checkbox") el.checked = data[k] === "1" || data[k] === true;
        else el.value = data[k];
      });
    } catch (_) {}
  };

  btnDraft?.addEventListener("click", () => { saveDraft(); alert("Draft saved on this device."); });
  form.addEventListener("input", saveDraft);
  form.addEventListener("change", saveDraft);
  btnReset?.addEventListener("click", () => {
    setTimeout(() => {
      try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
      if (submitStatus) submitStatus.textContent = "";
      syncAcademicYear();
      syncClassLevels();
      syncStreams();
      syncSections();
      syncQualifications();
      renderOtherDocs();
    }, 0);
  });
  btnNew?.addEventListener("click", () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
    window.location.href = applyActionUrl;
  });

  form.addEventListener("submit", async (e) => {
    if (!uploadPromises.size) return;
    e.preventDefault();
    if (submitStatus) submitStatus.textContent = "Finishing document uploads before submit...";
    const pending = Array.from(uploadPromises);
    const results = await Promise.allSettled(pending);
    const failed = results.find((r) => r.status === "rejected");
    if (failed) {
      if (submitStatus) submitStatus.textContent = failed.reason?.message || "Some documents failed to upload.";
      return;
    }
    if (submitStatus) submitStatus.textContent = "Submitting application...";
    form.requestSubmit ? form.requestSubmit() : form.submit();
  });

  termId?.addEventListener("change", syncAcademicYear);
  schoolLevel?.addEventListener("change", () => { syncClassLevels(); syncStreams(); syncSections(); syncQualifications(); });
  classLevel?.addEventListener("change", () => { syncStreams(); syncSections(); });
  streamId?.addEventListener("change", syncSections);
  qualification?.addEventListener("change", syncEducationFields);

  loadDraft();
  syncAcademicYear();
  syncClassLevels();
  syncStreams();
  syncSections();
  syncQualifications();
  refreshUploadUi();
})();
