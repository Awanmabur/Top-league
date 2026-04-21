(function () {
  const $ = (id) => document.getElementById(id);

  function readJson(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try {
      return JSON.parse(el.value || JSON.stringify(fallback));
    } catch (err) {
      console.error(`Failed to parse ${id}:`, err);
      return fallback;
    }
  }

  if (!$("tbodyStudents")) return;

  const TERMS = readJson("termsData", []);
  const STREAMS = readJson("streamsData", []);
  const SECTIONS = readJson("sectionsData", []);
  const QUALIFICATION_MAP = readJson("qualificationMapData", {});
  const LEVEL_CLASS_MAP = readJson("classLevelMap", {});
  const STUDENTS = readJson("studentsData", []).map((student) => ({
    ...student,
    intakeId: student.intakeId || guessTermId(student),
    documents: cloneDocState(student.documents),
  }));

  const state = {
    selected: new Set(),
    currentViewId: null,
    currentDocs: emptyDocState(),
  };

  const passportInput = $("mPassportPhoto");
  const idInput = $("mIdDocument");
  const transcriptInput = $("mTranscript");
  const otherDocsInput = $("mOtherDocs");
  const qualificationInput = $("mQualification");
  const schoolInput = $("mSchool");
  const yearCompletedInput = $("mYearCompleted");
  const dropZone = $("dropZone");
  const quickFiles = $("quickFiles");
  const fileList = $("fileList");
  const academicYearSelect = $("mAcademicYear");
  const academicYearDefaults = readAcademicYearDefaults();

  function emptyDocState() {
    return {
      passportPhoto: null,
      idDocument: null,
      transcript: null,
      otherDocs: [],
    };
  }

  function cloneDocState(docState) {
    return {
      passportPhoto: docState?.passportPhoto || null,
      idDocument: docState?.idDocument || null,
      transcript: docState?.transcript || null,
      otherDocs: Array.isArray(docState?.otherDocs) ? docState.otherDocs.slice() : [],
    };
  }

  function readAcademicYearDefaults() {
    if (!academicYearSelect) return [];
    try {
      return JSON.parse(academicYearSelect.dataset.defaultOptions || "[]");
    } catch (_) {
      return [];
    }
  }

  function guessTermId(student) {
    const termNo = String(student?.term || "").trim();
    const year = String(student?.academicYear || "").trim();
    const exact = TERMS.find((term) => termNumber(term) === termNo && String(term.year || "").trim() === year);
    if (exact) return String(exact._id || "");
    const fallback = TERMS.find((term) => termNumber(term) === termNo);
    return fallback ? String(fallback._id || "") : "";
  }

  function termNumber(term) {
    const raw = String(term?.term || term?.name || "");
    const match = raw.match(/\d+/);
    return match ? match[0] : "";
  }

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function humanSize(bytes) {
    const units = ["B", "KB", "MB", "GB"];
    let index = 0;
    let value = Number(bytes || 0);
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value.toFixed(value < 10 && index > 0 ? 1 : 0)} ${units[index]}`;
  }

  function schoolLevelLabel(v) {
    const map = { nursery: "Nursery", primary: "Primary", secondary: "Secondary" };
    return map[String(v || "").toLowerCase()] || v || "-";
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toISOString().slice(0, 10);
  }

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("show");
    if (!document.querySelector(".modal-backdrop.show")) {
      document.body.style.overflow = "";
    }
  }

  function submitRowAction(actionUrl, status) {
    const form = $("rowActionForm");
    if (!form) return;
    form.action = actionUrl;
    if ($("rowStatusField")) $("rowStatusField").value = status || "";
    form.submit();
  }

  function syncBulkbar() {
    $("selCount").textContent = String(state.selected.size);
    $("bulkbar").classList.toggle("show", state.selected.size > 0);
  }

  function statusPill(status) {
    if (status === "active") return '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Active</span>';
    if (status === "on_hold") return '<span class="pill warn"><i class="fa-solid fa-ban"></i> On Hold</span>';
    if (status === "suspended") return '<span class="pill bad"><i class="fa-solid fa-triangle-exclamation"></i> Suspended</span>';
    if (status === "graduated") return '<span class="pill info"><i class="fa-solid fa-graduation-cap"></i> Graduated</span>';
    return '<span class="pill arch"><i class="fa-solid fa-box-archive"></i> Archived</span>';
  }

  function docCount(docState) {
    let count = 0;
    if (docState?.passportPhoto) count += 1;
    if (docState?.idDocument) count += 1;
    if (docState?.transcript) count += 1;
    return count;
  }

  function extraDocCount(docState) {
    return Array.isArray(docState?.otherDocs) ? docState.otherDocs.length : 0;
  }

  function docPill(docState) {
    const requiredCount = docCount(docState);
    const extras = extraDocCount(docState);
    if (requiredCount === 3) {
      return `<span class="pill ok"><i class="fa-solid fa-folder-open"></i> Complete${extras ? ` +${extras}` : ""}</span>`;
    }
    if (requiredCount > 0) {
      return `<span class="pill warn"><i class="fa-solid fa-folder-open"></i> ${requiredCount}/3 uploaded${extras ? ` +${extras}` : ""}</span>`;
    }
    return '<span class="pill bad"><i class="fa-solid fa-folder-open"></i> Missing</span>';
  }

  function documentSummaryText(docState) {
    const parts = [];
    if (docState?.passportPhoto) parts.push("Passport");
    if (docState?.idDocument) parts.push("ID");
    if (docState?.transcript) parts.push("Transcript");
    if (Array.isArray(docState?.otherDocs) && docState.otherDocs.length) {
      parts.push(`${docState.otherDocs.length} other`);
    }
    return parts.length ? parts.join(", ") : "No documents";
  }

  function placementText(student) {
    return [
      termLabel(student),
      student.academicYear,
      schoolLevelLabel(student.schoolLevel),
      student.classLevel,
      student.stream,
      student.section,
    ].filter(Boolean).join(" / ") || "-";
  }

  function contactsText(student) {
    return [student.email, student.phone, student.guardianPhone].filter(Boolean).join(" / ") || "-";
  }

  function termLabel(student) {
    const term = TERMS.find((entry) => String(entry._id) === String(student.intakeId || ""));
    if (term?.name) return term.name;
    const num = String(student.term || "").trim();
    return num ? `Term ${num}` : "-";
  }

  function holdText(student) {
    return student.holdType ? `${student.holdType}${student.holdReason ? ` - ${student.holdReason}` : ""}` : "-";
  }

  function renderTable() {
    $("tbodyStudents").innerHTML =
      STUDENTS.map((student) => {
        const checked = state.selected.has(student.id) ? "checked" : "";
        const fullName = student.fullName || [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
        const docs = cloneDocState(student.documents);

        return `
          <tr class="row-clickable" data-id="${escapeHtml(student.id)}">
            <td class="col-check"><input type="checkbox" class="rowCheck" data-id="${escapeHtml(student.id)}" ${checked}></td>
            <td class="col-student">
              <div class="student-main">
                <div class="student-title" title="${escapeHtml(fullName || "-")}">${escapeHtml(fullName || "-")}</div>
                <div class="student-sub" title="${escapeHtml(student.regNo || "-")}">${escapeHtml(student.regNo || "-")}</div>
              </div>
            </td>
            <td class="col-placement"><span class="cell-ellipsis" title="${escapeHtml(placementText(student))}">${escapeHtml(placementText(student))}</span></td>
            <td class="col-docs">
              <div class="doc-summary">
                <div>${docPill(docs)}</div>
                <strong title="${escapeHtml(documentSummaryText(docs))}">${escapeHtml(documentSummaryText(docs))}</strong>
              </div>
            </td>
            <td class="col-contacts"><span class="cell-ellipsis" title="${escapeHtml(contactsText(student))}">${escapeHtml(contactsText(student))}</span></td>
            <td class="col-status">${statusPill(student.status)}</td>
            <td class="col-hold"><span class="cell-ellipsis" title="${escapeHtml(holdText(student))}">${escapeHtml(holdText(student))}</span></td>
            <td class="col-actions">
              <div class="actions">
                <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-xs actResend" type="button" title="Resend Setup"><i class="fa-solid fa-envelope"></i></button>
                <button class="btn-xs actArchive" type="button" title="Archive"><i class="fa-solid fa-box-archive"></i></button>
                <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </td>
          </tr>
        `;
      }).join("") ||
      `<tr><td colspan="8" style="padding:18px;"><div class="muted">No students found.</div></td></tr>`;

    $("checkAll").checked = STUDENTS.length > 0 && STUDENTS.every((student) => state.selected.has(student.id));
    syncBulkbar();
  }

  function refillSelect(select, options, selectedValue, placeholder) {
    if (!select) return;
    const selected = String(selectedValue == null ? "" : selectedValue);
    const seen = new Set();
    const html = [`<option value="">${escapeHtml(placeholder || "Select")}</option>`];

    options.forEach((option) => {
      const value = String(option.value ?? "");
      if (seen.has(value)) return;
      seen.add(value);
      const attrs = Object.entries(option.data || {})
        .map(([key, val]) => ` data-${escapeHtml(key)}="${escapeHtml(val)}"`)
        .join("");
      html.push(`<option value="${escapeHtml(value)}"${attrs} ${value === selected ? "selected" : ""}>${escapeHtml(option.label ?? value)}</option>`);
    });

    select.innerHTML = html.join("");
    select.value = selected && seen.has(selected) ? selected : "";
  }

  function syncAcademicYear(preferredYear) {
    if (!academicYearSelect) return;
    const selected = $("mTermId")?.selectedOptions?.[0] || null;
    const termYear = selected ? String(selected.getAttribute("data-year") || "").trim() : "";

    if (termYear) {
      refillSelect(
        academicYearSelect,
        [{ value: termYear, label: termYear }],
        termYear,
        "Select"
      );
      academicYearSelect.disabled = false;
      return;
    }

    refillSelect(
      academicYearSelect,
      academicYearDefaults.map((year) => ({ value: year, label: year })),
      preferredYear || academicYearSelect.value,
      "Select"
    );
    academicYearSelect.disabled = false;
  }

  function syncClassLevels(preferredValue) {
    const level = String($("mSchoolLevel")?.value || "").toLowerCase();
    const options = (LEVEL_CLASS_MAP[level] || []).map((value) => ({ value, label: value }));
    const selected = preferredValue || $("mClassLevel")?.value || "";
    refillSelect($("mClassLevel"), options, selected, "Select");
  }

  function syncStreams(preferredValue) {
    const level = String($("mSchoolLevel")?.value || "").toLowerCase();
    const classLevel = String($("mClassLevel")?.value || "").toUpperCase();
    let matching = STREAMS.filter((stream) => (!level || stream.levelType === level) && (!classLevel || stream.classLevel === classLevel));

    if (!matching.length && preferredValue) {
      const fallback = STREAMS.find((stream) => String(stream._id) === String(preferredValue));
      if (fallback) matching = [fallback];
    }

    refillSelect(
      $("mStreamId"),
      matching.map((stream) => ({
        value: stream._id,
        label: stream.name,
        data: {
          level: stream.levelType,
          classLevel: stream.classLevel,
          classId: stream.classId,
        },
      })),
      preferredValue || $("mStreamId")?.value || "",
      "Select stream"
    );
  }

  function syncSections(preferredValue) {
    const level = String($("mSchoolLevel")?.value || "").toLowerCase();
    const classLevel = String($("mClassLevel")?.value || "").toUpperCase();
    const stream = STREAMS.find((entry) => String(entry._id) === String($("mStreamId")?.value || ""));
    const classId = String(stream?.classId || "");

    let matching = SECTIONS.filter((section) =>
      (!level || section.levelType === level) &&
      (!classLevel || section.classLevel === classLevel) &&
      (!classId || String(section.classId || "") === classId)
    );

    if (!matching.length) {
      matching = SECTIONS.filter((section) =>
        (!level || section.levelType === level) &&
        (!classLevel || section.classLevel === classLevel)
      );
    }

    if (!matching.length && preferredValue) {
      const fallback = SECTIONS.find((section) => String(section._id) === String(preferredValue));
      if (fallback) matching = [fallback];
    }

    refillSelect(
      $("mSection1"),
      matching.map((section) => ({
        value: section._id,
        label: section.name,
        data: {
          level: section.levelType,
          classLevel: section.classLevel,
          classId: section.classId,
        },
      })),
      preferredValue || $("mSection1")?.value || "",
      "Select section"
    );

    $("mSection1").disabled = !matching.length;
  }

  function syncQualifications(preferredValue) {
    const level = String($("mSchoolLevel")?.value || "").toLowerCase();
    const values = Array.isArray(QUALIFICATION_MAP[level]) ? QUALIFICATION_MAP[level] : [];
    let options = values.map((value) => ({ value, label: value }));
    if (preferredValue && !values.includes(preferredValue)) {
      options = [{ value: preferredValue, label: preferredValue }].concat(options);
    }
    refillSelect($("mQualification"), options, preferredValue || $("mQualification")?.value || "", "Select");
    syncEducationFields();
  }

  function hasNoPreviousEducation() {
    return String(qualificationInput?.value || "").trim().toLowerCase() === "no previous education";
  }

  function setHint(id, text, tone, url) {
    const el = $(id);
    if (!el) return;
    if (!text) {
      el.textContent = "";
      return;
    }
    const color = tone === "error" ? "#b91c1c" : tone === "ok" ? "#15803d" : "#6b7280";
    el.style.color = color;
    if (url) {
      el.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>`;
    } else {
      el.textContent = text;
    }
  }

  function refreshDocumentUi() {
    const docs = state.currentDocs || emptyDocState();
    const noPreviousEducation = hasNoPreviousEducation();

    passportInput.required = !docs.passportPhoto;
    idInput.required = !docs.idDocument;
    transcriptInput.required = !noPreviousEducation && !docs.transcript;

    if (passportInput.files?.length) {
      setHint("passportPhotoStatus", `Selected: ${passportInput.files[0].name}`, "ok");
    } else if (docs.passportPhoto) {
      setHint("passportPhotoStatus", `Saved: ${docs.passportPhoto.originalName || "Passport Photo"}`, "ok", docs.passportPhoto.url);
    } else {
      setHint("passportPhotoStatus", "Not uploaded yet", "");
    }

    if (idInput.files?.length) {
      setHint("idDocumentStatus", `Selected: ${idInput.files[0].name}`, "ok");
    } else if (docs.idDocument) {
      setHint("idDocumentStatus", `Saved: ${docs.idDocument.originalName || "National ID / Passport"}`, "ok", docs.idDocument.url);
    } else {
      setHint("idDocumentStatus", "Not uploaded yet", "");
    }

    if (noPreviousEducation) {
      setHint("transcriptStatus", "Not required for no previous education", "ok");
    } else if (transcriptInput.files?.length) {
      setHint("transcriptStatus", `Selected: ${transcriptInput.files[0].name}`, "ok");
    } else if (docs.transcript) {
      setHint("transcriptStatus", `Saved: ${docs.transcript.originalName || "Transcript"}`, "ok", docs.transcript.url);
    } else {
      setHint("transcriptStatus", "Not uploaded yet", "");
    }

    const extraCount = extraDocCount(docs);
    if ((otherDocsInput.files?.length || 0) > 0) {
      setHint("otherDocsStatus", `${otherDocsInput.files.length} file(s) selected`, "ok");
    } else if (extraCount) {
      setHint("otherDocsStatus", `${extraCount} extra document(s) saved`, "ok");
    } else {
      setHint("otherDocsStatus", "Optional", "");
    }

    renderOtherDocs();
  }

  function syncEducationFields() {
    const noPreviousEducation = hasNoPreviousEducation();
    if (schoolInput) {
      schoolInput.disabled = noPreviousEducation;
      schoolInput.required = !noPreviousEducation;
      if (noPreviousEducation) schoolInput.value = "";
    }
    if (yearCompletedInput) {
      yearCompletedInput.disabled = noPreviousEducation;
      yearCompletedInput.required = !noPreviousEducation;
      if (noPreviousEducation) yearCompletedInput.value = "";
    }
    refreshDocumentUi();
  }

  function renderOtherDocs() {
    if (!fileList) return;
    const savedDocs = Array.isArray(state.currentDocs?.otherDocs) ? state.currentDocs.otherDocs : [];
    const pendingDocs = otherDocsInput.files ? Array.from(otherDocsInput.files) : [];
    const blocks = [];

    savedDocs.forEach((doc) => {
      blocks.push(`
        <div class="file-row">
          <div style="min-width:0">
            <div class="name">${escapeHtml(doc.originalName || "Saved document")}</div>
            <div class="meta">${escapeHtml(humanSize(doc.bytes))}</div>
          </div>
          <a class="pill ok" href="${escapeHtml(doc.url || "#")}" target="_blank" rel="noreferrer"><i class="fa-solid fa-check"></i> Saved</a>
        </div>
      `);
    });

    pendingDocs.forEach((file) => {
      blocks.push(`
        <div class="file-row">
          <div style="min-width:0">
            <div class="name">${escapeHtml(file.name)}</div>
            <div class="meta">${escapeHtml(humanSize(file.size))}</div>
          </div>
          <span class="pill warn"><i class="fa-solid fa-arrow-up"></i> Pending</span>
        </div>
      `);
    });

    fileList.innerHTML = blocks.length ? blocks.join("") : '<div class="muted">No extra files selected yet.</div>';
  }

  function mergeIntoOtherDocs(newFiles) {
    const dt = new DataTransfer();
    const existing = otherDocsInput.files ? Array.from(otherDocsInput.files) : [];
    existing.concat(newFiles).forEach((file) => dt.items.add(file));
    otherDocsInput.files = dt.files;
    if (quickFiles) quickFiles.value = "";
    refreshDocumentUi();
  }

  function resetTabs() {
    document.querySelectorAll(".tab").forEach((tab, index) => {
      tab.classList.toggle("active", index === 0);
    });
    document.querySelectorAll(".tab-pane").forEach((pane, index) => {
      pane.classList.toggle("active", index === 0);
    });
  }

  function openEditor(student) {
    const form = $("studentForm");
    const current = student
      ? {
          ...student,
          intakeId: student.intakeId || guessTermId(student),
          documents: cloneDocState(student.documents),
        }
      : null;

    form.reset();
    if (quickFiles) quickFiles.value = "";
    state.currentDocs = cloneDocState(current?.documents);

    $("mTitleBar").textContent = current ? "Edit Student" : "Add Student";
    form.action = current ? `/admin/students/${encodeURIComponent(current.id)}` : "/admin/students";

    $("mFirstName").value = current?.firstName || "";
    $("mMiddleName").value = current?.middleName || "";
    $("mLastName").value = current?.lastName || "";
    $("mGender").value = current?.gender || "";
    $("mDob").value = current?.dob ? formatDate(current.dob) : "";
    $("mNationality").value = current?.nationality || "";
    $("mPhone").value = current?.phone || "";
    $("mEmail").value = current?.email || "";
    $("mAddress").value = current?.address || "";
    $("mRegNo").value = current?.regNo || "";
    $("mStatus").value = current?.status || "active";
    $("mHoldType").value = current?.holdType || "";
    $("mHoldReason").value = current?.holdReason || "";
    $("mNotes").value = current?.notes || "";
    $("mGuardianName").value = current?.guardianName || "";
    $("mGuardianPhone").value = current?.guardianPhone || "";
    $("mGuardianEmail").value = current?.guardianEmail || "";
    $("mGrades").value = current?.grades || "";
    $("mSchool").value = current?.school || "";
    $("mYearCompleted").value = current?.yearCompleted || "";
    $("mTermId").value = current?.intakeId || "";
    $("mSchoolLevel").value = current?.schoolLevel || "";

    syncAcademicYear(current?.academicYear || "");
    if (current?.academicYear && academicYearSelect.querySelector(`option[value="${CSS.escape(String(current.academicYear))}"]`)) {
      academicYearSelect.value = current.academicYear;
    }

    syncClassLevels(current?.classLevel || "");
    syncStreams(current?.streamId || "");
    syncSections(current?.sectionId || "");
    syncQualifications(current?.qualification || "");

    $("mClassLevel").value = current?.classLevel || $("mClassLevel").value;
    syncStreams(current?.streamId || "");
    $("mStreamId").value = current?.streamId || $("mStreamId").value;
    syncSections(current?.sectionId || "");
    $("mSection1").value = current?.sectionId || $("mSection1").value;
    $("mQualification").value = current?.qualification || $("mQualification").value;
    syncEducationFields();
    refreshDocumentUi();
    resetTabs();
    updateHoldCounter();
    openModal("mEdit");
  }

  function renderDocumentLinks(docState) {
    const docs = [];
    if (docState?.passportPhoto) docs.push({ label: "Passport Photo", doc: docState.passportPhoto });
    if (docState?.idDocument) docs.push({ label: "National ID / Passport", doc: docState.idDocument });
    if (docState?.transcript) docs.push({ label: "Transcript / Results Slip", doc: docState.transcript });
    (docState?.otherDocs || []).forEach((doc, index) => docs.push({ label: doc.originalName || `Other Document ${index + 1}`, doc }));

    if (!docs.length) {
      return '<div class="muted">No documents uploaded yet.</div>';
    }

    return docs.map((item) => {
      const bytes = item.doc?.bytes ? humanSize(item.doc.bytes) : "";
      return `
        <a class="doc-link" href="${escapeHtml(item.doc?.url || "#")}" target="_blank" rel="noreferrer">
          <div style="min-width:0">
            <div class="strong">${escapeHtml(item.label)}</div>
            <div class="meta">${escapeHtml(item.doc?.originalName || "")}${bytes ? ` - ${escapeHtml(bytes)}` : ""}</div>
          </div>
          <i class="fa-solid fa-arrow-up-right-from-square"></i>
        </a>
      `;
    }).join("");
  }

  function openViewModal(student) {
    if (!student) return;

    const fullName = student.fullName || [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
    state.currentViewId = student.id;

    $("vFullName").textContent = fullName || "-";
    $("vRegNo").textContent = student.regNo || "-";
    $("vStatus").innerHTML = statusPill(student.status || "active");
    $("vTerm").textContent = termLabel(student);
    $("vAcademicYear").textContent = student.academicYear || "-";
    $("vSchoolLevel").textContent = schoolLevelLabel(student.schoolLevel);
    $("vClassLevel").textContent = student.classLevel || "-";
    $("vStream").textContent = student.stream || "-";
    $("vSection").textContent = student.section || "-";
    $("vDob").textContent = student.dob ? formatDate(student.dob) : "-";
    $("vNationality").textContent = student.nationality || "-";
    $("vEmail").textContent = student.email || "-";
    $("vPhone").textContent = student.phone || "-";
    $("vGuardian").textContent = [student.guardianName, student.guardianPhone, student.guardianEmail].filter(Boolean).join(" / ") || "-";
    $("vQualification").textContent = student.qualification || "-";
    $("vSchool").textContent = student.school || "-";
    $("vYearCompleted").textContent = student.yearCompleted || "-";
    $("vGrades").textContent = student.grades || "-";
    $("vAddress").textContent = student.address || "-";
    $("vNotes").textContent = student.notes || "-";
    $("vHold").textContent = holdText(student);
    $("vDocuments").innerHTML = renderDocumentLinks(student.documents || emptyDocState());

    openModal("mView");
  }

  function updateHoldCounter() {
    $("holdReasonCount").textContent = `${$("mHoldReason").value.length} / 200`;
  }

  function saveStudent() {
    const requiredFields = [
      ["mFirstName", "first name"],
      ["mLastName", "last name"],
      ["mGender", "gender"],
      ["mDob", "date of birth"],
      ["mNationality", "nationality"],
      ["mPhone", "phone"],
      ["mEmail", "email"],
      ["mAddress", "address"],
      ["mTermId", "term"],
      ["mAcademicYear", "academic year"],
      ["mSchoolLevel", "school level"],
      ["mClassLevel", "class level"],
      ["mStreamId", "stream"],
      ["mSection1", "section"],
      ["mQualification", "highest qualification"],
      ["mGuardianName", "guardian name"],
      ["mGuardianPhone", "guardian phone"],
    ];

    const missing = requiredFields
      .filter(([id]) => !String($(id)?.value || "").trim())
      .map(([, label]) => label);

    if (!hasNoPreviousEducation()) {
      if (!String($("mSchool").value || "").trim()) missing.push("school / institution");
      if (!String($("mYearCompleted").value || "").trim()) missing.push("year completed");
      const yearCompleted = Number($("mYearCompleted").value || 0);
      const currentYear = new Date().getFullYear();
      if ($("mYearCompleted").value && (Number.isNaN(yearCompleted) || yearCompleted < 1900 || yearCompleted > currentYear + 1)) {
        return alert("Year completed is invalid.");
      }
    }

    const docs = state.currentDocs || emptyDocState();
    if (!docs.passportPhoto && !passportInput.files?.length) missing.push("passport photo");
    if (!docs.idDocument && !idInput.files?.length) missing.push("national ID / passport scan");
    if (!hasNoPreviousEducation() && !docs.transcript && !transcriptInput.files?.length) missing.push("transcript / results slip");

    if (missing.length) {
      return alert(`Please complete: ${missing.join(", ")}.`);
    }

    $("mFullName").value = [$("mFirstName").value, $("mMiddleName").value, $("mLastName").value]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");

    $("studentForm").submit();
  }

  function submitBulk(action, extra = {}) {
    const ids = Array.from(state.selected);
    if (!ids.length) return alert("Select at least one student.");

    if (action === "delete" && !window.confirm(`Delete ${ids.length} selected student(s)?`)) return;
    if (action === "archive" && !window.confirm(`Archive ${ids.length} selected student(s)?`)) return;

    $("bulkActionVal").value = action;
    $("bulkStatusVal").value = extra.status || "";
    $("bulkHoldTypeVal").value = extra.holdType || "";
    $("bulkHoldReasonVal").value = extra.holdReason || "";
    $("bulkIdsVal").value = ids.join(",");
    $("bulkForm").submit();
  }

  $("btnCreate").addEventListener("click", () => openEditor());
  $("quickActive").addEventListener("click", () => {
    openEditor();
    $("mStatus").value = "active";
  });
  $("quickHold").addEventListener("click", () => {
    openEditor();
    $("mStatus").value = "on_hold";
  });
  $("btnImport").addEventListener("click", () => openModal("mImport"));
  $("quickImport").addEventListener("click", () => openModal("mImport"));
  $("btnPrint").addEventListener("click", () => window.print());
  $("btnBulk").addEventListener("click", () => {
    if (!state.selected.size) return alert("Select at least one student.");
    $("bulkbar").classList.add("show");
  });

  $("bulkSetStatus").addEventListener("click", () => {
    const status = prompt("Enter status: active, on_hold, suspended, graduated, archived");
    if (!status) return;
    submitBulk("set_status", { status });
  });
  $("bulkApplyHold").addEventListener("click", () => {
    const holdType = prompt("Enter hold type:");
    if (!holdType) return;
    const holdReason = prompt("Enter hold reason (optional):") || "";
    submitBulk("set_hold", { holdType, holdReason });
  });
  $("bulkClearHold").addEventListener("click", () => submitBulk("clear_hold"));
  $("bulkArchive").addEventListener("click", () => submitBulk("archive"));
  $("bulkDelete").addEventListener("click", () => submitBulk("delete"));
  $("bulkClear").addEventListener("click", () => {
    state.selected.clear();
    renderTable();
  });

  $("checkAll").addEventListener("change", (event) => {
    if (event.target.checked) {
      STUDENTS.forEach((student) => state.selected.add(student.id));
    } else {
      STUDENTS.forEach((student) => state.selected.delete(student.id));
    }
    renderTable();
  });

  $("tbodyStudents").addEventListener("change", (event) => {
    if (!event.target.classList.contains("rowCheck")) return;
    const id = event.target.dataset.id;
    if (event.target.checked) state.selected.add(id);
    else state.selected.delete(id);
    renderTable();
  });

  $("tbodyStudents").addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-id]");
    if (!row) return;

    const student = STUDENTS.find((entry) => entry.id === row.dataset.id);
    if (!student) return;

    if (event.target.closest(".rowCheck") || event.target.closest(".actions") || event.target.closest(".btn-xs")) {
      if (event.target.closest(".actView")) return openViewModal(student);
      if (event.target.closest(".actEdit")) return openEditor(student);
      if (event.target.closest(".actResend")) {
        if (!window.confirm(`Resend setup link for "${student.fullName || student.regNo}"?`)) return;
        return submitRowAction(`/admin/students/${encodeURIComponent(student.id)}/resend-setup`);
      }
      if (event.target.closest(".actArchive")) {
        if (!window.confirm(`Archive "${student.fullName || student.regNo}"?`)) return;
        return submitRowAction(`/admin/students/${encodeURIComponent(student.id)}/archive`);
      }
      if (event.target.closest(".actDelete")) {
        if (!window.confirm(`Delete "${student.fullName || student.regNo}"?`)) return;
        return submitRowAction(`/admin/students/${encodeURIComponent(student.id)}/delete`);
      }
      return;
    }

    openViewModal(student);
  });

  $("viewEditBtn").addEventListener("click", () => {
    const student = STUDENTS.find((entry) => entry.id === state.currentViewId);
    if (!student) return;
    closeModal("mView");
    openEditor(student);
  });
  $("viewArchiveBtn").addEventListener("click", () => {
    const student = STUDENTS.find((entry) => entry.id === state.currentViewId);
    if (!student) return;
    if (!window.confirm(`Archive "${student.fullName || student.regNo}"?`)) return;
    submitRowAction(`/admin/students/${encodeURIComponent(student.id)}/archive`);
  });
  $("viewResendBtn").addEventListener("click", () => {
    const student = STUDENTS.find((entry) => entry.id === state.currentViewId);
    if (!student) return;
    if (!window.confirm(`Resend setup link for "${student.fullName || student.regNo}"?`)) return;
    submitRowAction(`/admin/students/${encodeURIComponent(student.id)}/resend-setup`);
  });

  $("saveBtn").addEventListener("click", saveStudent);
  $("mHoldReason").addEventListener("input", updateHoldCounter);
  $("mTermId").addEventListener("change", () => syncAcademicYear(""));
  $("mSchoolLevel").addEventListener("change", () => {
    syncClassLevels("");
    syncStreams("");
    syncSections("");
    syncQualifications("");
  });
  $("mClassLevel").addEventListener("change", () => {
    syncStreams("");
    syncSections("");
  });
  $("mStreamId").addEventListener("change", () => syncSections(""));
  $("mQualification").addEventListener("change", syncEducationFields);

  passportInput.addEventListener("change", refreshDocumentUi);
  idInput.addEventListener("change", refreshDocumentUi);
  transcriptInput.addEventListener("change", refreshDocumentUi);
  otherDocsInput.addEventListener("change", refreshDocumentUi);

  if (dropZone && quickFiles) {
    const isAllowed = (file) => /(\.pdf|\.jpg|\.jpeg|\.png)$/i.test(file.name || "") || /pdf|image\//i.test(file.type || "");
    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropZone.classList.add("drag");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag"));
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag");
      const files = Array.from(event.dataTransfer.files || []).filter(isAllowed);
      if (files.length) mergeIntoOtherDocs(files);
    });
    $("pickQuick").addEventListener("click", () => quickFiles.click());
    quickFiles.addEventListener("change", () => {
      const files = Array.from(quickFiles.files || []).filter(isAllowed);
      if (files.length) mergeIntoOtherDocs(files);
    });
  }

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.closeModal));
  });

  ["mEdit", "mView", "mImport"].forEach((modalId) => {
    const el = $(modalId);
    if (!el) return;
    el.addEventListener("click", (event) => {
      if (event.target.id === modalId) closeModal(modalId);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show"));
    document.body.style.overflow = "";
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.tab;
      document.querySelectorAll(".tab").forEach((entry) => entry.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.remove("active"));
      tab.classList.add("active");
      const pane = document.getElementById(`tab-${key}`);
      if (pane) pane.classList.add("active");
    });
  });

  renderTable();
  syncAcademicYear("");
  updateHoldCounter();
  refreshDocumentUi();

  if (new URLSearchParams(window.location.search).get("import") === "1") {
    openModal("mImport");
  }
})();
