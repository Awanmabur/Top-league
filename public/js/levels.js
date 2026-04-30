(function () {
  const $ = (id) => document.getElementById(id);
  function parseJson(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try { return JSON.parse(el.value || "null") ?? fallback; } catch (_) { return fallback; }
  }

  const LEVELS = parseJson("levelsData", []);
  const STRUCTURE = parseJson("structureData", []);
  if (!$("tbodyLevels")) return;

  const state = { currentViewId: null };

  function escapeHtml(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function statusPill(status) {
    return status === "active"
      ? '<span class="pill ok"><i class="fa-solid fa-circle-check"></i> Active</span>'
      : '<span class="pill bad"><i class="fa-solid fa-circle-minus"></i> Inactive</span>';
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
    document.body.style.overflow = "";
  }

  function fillCampuses(selectedSchoolUnitCode, selectedCampusCode) {
    const campusSel = $("mCampusCode");
    const level = STRUCTURE.find((unit) => unit.code === selectedSchoolUnitCode);
    const campuses = level ? (level.campuses || []) : [];
    campusSel.innerHTML = ['<option value="">- Select Location -</option>']
      .concat(campuses.map((campus) => `<option value="${escapeHtml(campus.code)}">${escapeHtml(campus.name)}</option>`))
      .join("");
    campusSel.value = selectedCampusCode || "";
    if (!campusSel.value && campusSel.options.length === 2) {
      campusSel.selectedIndex = 1;
    }
  }

  function currentCategory() {
    const unit = STRUCTURE.find((item) => item.code === $("mSchoolUnitCode").value);
    return unit?.category || "mixed";
  }

  function buildDefaultSections(levelName, category) {
    const upper = String(levelName || "").trim().toUpperCase();
    if (["BABY", "MIDDLE", "TOP"].includes(upper) || category === "nursery") return ["RED", "BLUE"];
    if (upper.startsWith("P") || upper.startsWith("S")) return ["A", "B"];
    return [];
  }

  function maybeSeedSections() {
    const sections = $("mSectionsText");
    if (!sections || sections.dataset.touched === "1") return;
    const defaults = buildDefaultSections($("mName").value, currentCategory());
    sections.value = defaults.join(", ");
    updateCounters();
  }

  function openEditor(prefill) {
    const s = prefill || null;
    $("mTitleBar").textContent = s ? "Edit Level" : "Add Level";
    $("levelForm").action = s ? `/admin/levels/${encodeURIComponent(s.schoolUnitCode)}/${encodeURIComponent(s.campusCode)}/${encodeURIComponent(s.levelCode)}` : "/admin/levels";
    $("mName").value = s ? s.levelName || "" : "";
    $("mCode").value = s ? s.levelCode || "" : "";
    $("mStatus").value = s ? s.status || "active" : "active";
    $("mSchoolUnitCode").value = s ? s.schoolUnitCode || "" : (STRUCTURE[0]?.code || "");
    fillCampuses($("mSchoolUnitCode").value, s ? s.campusCode || "" : (STRUCTURE[0]?.campuses?.[0]?.code || ""));
    $("mTitle").value = s ? s.profile?.title || "" : "";
    $("mCurriculum").value = s ? s.profile?.curriculum || "" : "";
    $("mDescription").value = s ? s.profile?.description || "" : "";
    $("mAdmissionsNote").value = s ? s.profile?.admissionsNote || "" : "";
    $("mFeesNote").value = s ? s.profile?.feesNote || "" : "";
    $("mSectionsText").value = s ? (s.sections || []).map((item) => item.name).join(", ") : "";
    $("mSectionsText").dataset.touched = s ? "1" : "0";
    if (!s) maybeSeedSections();
    updateCounters();
    openModal("mEdit");
  }

  function openViewModal(level) {
    if (!level) return;
    state.currentViewId = level.id;
    $("vName").textContent = level.levelName || "-";
    $("vCode").textContent = level.levelCode || "-";
    $("vSchoolUnit").textContent = level.schoolUnitName || "-";
    $("vCampus").textContent = level.campusName || "-";
    $("vStatus").innerHTML = statusPill(level.status || "active");
    $("vSections").textContent = (level.sections || []).map((item) => item.name).join(", ") || "-";
    $("vTitle").textContent = level.profile?.title || "-";
    $("vCurriculum").textContent = level.profile?.curriculum || "-";
    $("vDescription").textContent = level.profile?.description || "-";
    $("vAdmissionsNote").textContent = level.profile?.admissionsNote || "-";
    $("vFeesNote").textContent = level.profile?.feesNote || "-";
    openModal("mView");
  }

  function updateCounters() {
    $("descCount").textContent = `${$("mDescription").value.length} / 2000`;
    $("sectionsCount").textContent = `${$("mSectionsText").value.length} / 1000`;
  }

  function renderTable() {
    $("tbodyLevels").innerHTML = LEVELS.map((item) => `
      <tr class="row-clickable" data-id="${escapeHtml(item.id)}">
        <td><div class="strong">${escapeHtml(item.levelName)}</div><div class="muted">${escapeHtml(item.levelCode)}</div></td>
        <td>${escapeHtml(item.schoolUnitName)}</td>
        <td>${escapeHtml(item.campusName)}</td>
        <td>${escapeHtml((item.sections || []).map((x) => x.name).join(", ") || "-")}</td>
        <td>${statusPill(item.status)}</td>
        <td style="text-align:right"><div class="actions"><button class="btn-xs actView" type="button"><i class="fa-solid fa-eye"></i></button><button class="btn-xs actEdit" type="button"><i class="fa-solid fa-pen"></i></button><button class="btn-xs actStatus" type="button"><i class="fa-solid fa-rotate"></i></button><button class="btn-xs actDelete" type="button"><i class="fa-solid fa-trash"></i></button></div></td>
      </tr>
    `).join("") || '<tr><td colspan="6" style="padding:18px;"><div class="muted">No levels found.</div></td></tr>';
  }

  function submitRowAction(actionUrl, status) {
    const form = $("rowActionForm");
    form.action = actionUrl;
    if ($("rowStatusField")) $("rowStatusField").value = status || "";
    form.submit();
  }

  $("btnCreate")?.addEventListener("click", function () { openEditor(); });
  $("btnExport")?.addEventListener("click", function () {
    const rows = [["Level", "Code", "School Unit", "Location", "Sections", "Status"]]
      .concat(LEVELS.map((item) => [item.levelName, item.levelCode, item.schoolUnitName, item.campusName, (item.sections || []).map((x) => x.name).join(" | "), item.status]));
    const esc = (value) => {
      const s = String(value ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = rows.map((row) => row.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "levels-export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  $("mSchoolUnitCode")?.addEventListener("change", function () {
    fillCampuses(this.value, "");
    maybeSeedSections();
  });
  $("mName")?.addEventListener("input", maybeSeedSections);
  $("mSectionsText")?.addEventListener("input", function () { this.dataset.touched = "1"; updateCounters(); });
  $("mDescription")?.addEventListener("input", updateCounters);
  $("saveBtn")?.addEventListener("click", function () {
    if (!$("mName").value.trim()) return alert("Level name is required.");
    if (!$("mSchoolUnitCode").value) return alert("School unit is required.");
    if (!$("mCampusCode").value) return alert("Location is required.");
    $("levelForm").submit();
  });

  $("tbodyLevels")?.addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const item = LEVELS.find((x) => x.id === tr.dataset.id);
    if (!item) return;
    if (e.target.closest(".actView")) return openViewModal(item);
    if (e.target.closest(".actEdit")) return openEditor(item);
    if (e.target.closest(".actStatus")) {
      const next = item.status === "active" ? "inactive" : "active";
      if (!window.confirm(`Change "${item.levelName}" to ${next}?`)) return;
      return submitRowAction(`/admin/levels/${encodeURIComponent(item.schoolUnitCode)}/${encodeURIComponent(item.campusCode)}/${encodeURIComponent(item.levelCode)}/status`, next);
    }
    if (e.target.closest(".actDelete")) {
      if (!window.confirm(`Delete "${item.levelName}" and its stream configuration?`)) return;
      return submitRowAction(`/admin/levels/${encodeURIComponent(item.schoolUnitCode)}/${encodeURIComponent(item.campusCode)}/${encodeURIComponent(item.levelCode)}/delete`);
    }
    openViewModal(item);
  });

  $("viewEditBtn")?.addEventListener("click", function () {
    const item = LEVELS.find((x) => x.id === state.currentViewId);
    if (!item) return;
    closeModal("mView");
    openEditor(item);
  });
  $("viewActivateBtn")?.addEventListener("click", function () {
    const item = LEVELS.find((x) => x.id === state.currentViewId);
    if (!item) return;
    submitRowAction(`/admin/levels/${encodeURIComponent(item.schoolUnitCode)}/${encodeURIComponent(item.campusCode)}/${encodeURIComponent(item.levelCode)}/status`, "active");
  });
  $("viewDeactivateBtn")?.addEventListener("click", function () {
    const item = LEVELS.find((x) => x.id === state.currentViewId);
    if (!item) return;
    submitRowAction(`/admin/levels/${encodeURIComponent(item.schoolUnitCode)}/${encodeURIComponent(item.campusCode)}/${encodeURIComponent(item.levelCode)}/status`, "inactive");
  });

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", function () { closeModal(btn.dataset.closeModal); });
  });
  ["mEdit", "mView"].forEach(function (id) {
    const el = $(id);
    if (!el) return;
    el.addEventListener("click", function (e) { if (e.target.id === id) closeModal(id); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.show").forEach((el) => el.classList.remove("show"));
      document.body.style.overflow = "";
    }
  });

  renderTable();
  updateCounters();
})();

