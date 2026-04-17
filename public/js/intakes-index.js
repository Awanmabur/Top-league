    (function () {
      "use strict";

      const $ = (id) => document.getElementById(id);

      function parseJson(id) {
        const el = $(id);
        if (!el) return [];
        try { return JSON.parse(el.value || "[]"); }
        catch (err) {
          console.error("JSON parse failed:", err);
          return [];
        }
      }

      const INTAKES = parseJson("intakesData");
      const PROGRAMS = parseJson("programsData");
      if (!$("tbodyIntakes")) return;

      const state = {
        selected: new Set(),
        currentViewId: null,
        isEditing: false
      };

      function escapeHtml(v) {
        return String(v ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
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

      function submitRowAction(actionUrl, statusValue) {
        const form = $("rowActionForm");
        if (!form) return;
        form.action = actionUrl;
        $("rowActionStatus").value = statusValue || "";
        form.submit();
      }

      function syncBulkbar() {
        $("selCount").textContent = String(state.selected.size);
        $("bulkbar").classList.toggle("show", state.selected.size > 0);
      }

      function formatDate(value) {
        if (!value) return "—";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "—";
        return d.toLocaleDateString();
      }

      function statusPill(status) {
        if (status === "open") {
          return '<span class="pill ok"><i class="fa-solid fa-door-open"></i> Open</span>';
        }
        if (status === "closed") {
          return '<span class="pill warn"><i class="fa-solid fa-lock"></i> Closed</span>';
        }
        if (status === "archived") {
          return '<span class="pill bad"><i class="fa-solid fa-box-archive"></i> Archived</span>';
        }
        return '<span class="pill draft"><i class="fa-solid fa-pen-to-square"></i> Draft</span>';
      }

      function activePill(flag) {
        return flag
          ? '<span class="pill info"><i class="fa-solid fa-bolt"></i> Active</span>'
          : '<span class="muted">—</span>';
      }

      function programSummary(intake) {
        const arr = Array.isArray(intake.programs) ? intake.programs : [];
        if (!arr.length || intake.allowAllPrograms) return "All sections";
        const names = arr.slice(0, 2).map((x) => {
          const label = [x.code, x.name].filter(Boolean).join(" — ");
          return label || "Section";
        });
        return names.join(", ") + (arr.length > 2 ? ` +${arr.length - 2}` : "");
      }

      function renderTable() {
        $("tbodyIntakes").innerHTML =
          INTAKES.map((it) => {
            const checked = state.selected.has(it.id) ? "checked" : "";
            return `
              <tr class="row-clickable" data-id="${escapeHtml(it.id)}">
                <td class="col-check">
                  <input type="checkbox" class="rowCheck" data-id="${escapeHtml(it.id)}" ${checked}>
                </td>

                <td class="col-intake">
                  <div class="intake-main">
                    <div class="intake-title" title="${escapeHtml(it.name)}">${escapeHtml(it.name || "—")}</div>
                    <div class="intake-sub">${it.isActive ? "Default active intake" : "Admissions intake"}</div>
                  </div>
                </td>

                <td class="col-code">
                  <span class="cell-ellipsis" title="${escapeHtml(it.code || "—")}">${escapeHtml(it.code || "—")}</span>
                </td>

                <td class="col-apply">
                  <span class="cell-ellipsis" title="${escapeHtml(formatDate(it.applicationOpenDate) + " → " + formatDate(it.applicationCloseDate))}">
                    ${escapeHtml(formatDate(it.applicationOpenDate))} → ${escapeHtml(formatDate(it.applicationCloseDate))}
                  </span>
                </td>

                <td class="col-study">
                  <span class="cell-ellipsis" title="${escapeHtml(formatDate(it.startDate) + " → " + formatDate(it.endDate))}">
                    ${escapeHtml(formatDate(it.startDate))} → ${escapeHtml(formatDate(it.endDate))}
                  </span>
                </td>

                <td class="col-programs">
                  <span class="cell-ellipsis" title="${escapeHtml(programSummary(it))}">
                    ${escapeHtml(programSummary(it))}
                  </span>
                </td>

                <td class="col-capacity">
                  <span class="cell-ellipsis">${escapeHtml(String(it.totalCapacity || 0))}</span>
                </td>

                <td class="col-applicants">
                  <span class="cell-ellipsis">${escapeHtml(String(it.applicants || 0))}</span>
                </td>

                <td class="col-status">
                  ${statusPill(it.status)}
                </td>

                <td class="col-active">
                  ${activePill(it.isActive)}
                </td>

                <td class="col-actions">
                  <div class="actions">
                    <button class="btn-xs actView" type="button" title="View"><i class="fa-solid fa-eye"></i></button>
                    <button class="btn-xs actEdit" type="button" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-xs actSetActive" type="button" title="Set Active"><i class="fa-solid fa-bolt"></i></button>
                    <button class="btn-xs actToggle" type="button" title="Toggle Status"><i class="fa-solid fa-repeat"></i></button>
                    <button class="btn-xs actDelete" type="button" title="Delete"><i class="fa-solid fa-trash"></i></button>
                  </div>
                </td>
              </tr>
            `;
          }).join("") ||
          `
            <tr>
              <td colspan="11" style="padding:18px;">
                <div class="muted">No intakes found.</div>
              </td>
            </tr>
          `;

        $("checkAll").checked = INTAKES.length > 0 && INTAKES.every((it) => state.selected.has(it.id));
        syncBulkbar();
      }

      function programOptionHtml(selectedValue) {
        return [
          '<option value="">Select section...</option>',
          ...PROGRAMS.map((p) => {
            const selected = String(selectedValue || "") === String(p._id) ? "selected" : "";
            const label = [p.code, p.name].filter(Boolean).join(" — ");
            return `<option value="${escapeHtml(p._id)}" ${selected}>${escapeHtml(label || "Section")}</option>`;
          })
        ].join("");
      }

      function addProgramRow(init) {
        const wrap = $("programRows");
        if (!wrap) return;

        const row = document.createElement("div");
        row.className = "prog-row";
        row.setAttribute("data-prog-row", "1");
        row.innerHTML = `
          <div class="field">
            <label>Section</label>
            <select class="select" data-program>
              ${programOptionHtml(init?.program || "")}
            </select>
          </div>

          <div class="field">
            <label>Capacity</label>
            <input class="input" data-capacity type="number" min="0" value="${escapeHtml(String(init?.capacity ?? ""))}" />
          </div>

          <div class="field">
            <label>&nbsp;</label>
            <button class="btn-xs" type="button" data-remove-row><i class="fa-solid fa-trash"></i></button>
          </div>
        `;
        wrap.appendChild(row);
        syncProgramsJson();
      }

      function getProgramRows() {
        const rows = Array.from(document.querySelectorAll("[data-prog-row]"));
        return rows.map((row) => {
          const program = row.querySelector("[data-program]")?.value || "";
          const capacity = Number(row.querySelector("[data-capacity]")?.value || 0);
          return { program, capacity };
        }).filter((x) => x.program);
      }

      function syncProgramsJson() {
        const allowAll = $("mAllowAllPrograms").value === "1";
        const rows = allowAll ? [] : getProgramRows();
        $("mProgramsJson").value = JSON.stringify(rows);

        const total = rows.reduce((sum, x) => sum + (Number(x.capacity) || 0), 0);
        $("mCapTotal").textContent = String(total);

        $("programRows").style.display = allowAll ? "none" : "block";
      }

      function resetEditor() {
        state.isEditing = false;
        $("mTitle").textContent = "Add Term";
        $("intakeForm").action = "/admin/admissions/intakes/new";

        $("mName").value = "";
        $("mCode").value = "";
        $("mStatus").value = "draft";
        if ($("mYear")) $("mYear").value = "";
        if ($("mTerm")) $("mTerm").value = "";
        $("mApplicationOpenDate").value = "";
        $("mApplicationCloseDate").value = "";
        $("mStartDate").value = "";
        $("mEndDate").value = "";
        $("mIsActive").value = "0";
        $("mAllowAllPrograms").value = "1";
        $("programRows").innerHTML = "";
        $("mProgramsJson").value = "[]";
        $("mCapTotal").textContent = "0";
        syncProgramsJson();
      }

      function buildTermCodePreview() {
        if (state.isEditing) return;
        const name = ($("mName") && $("mName").value || "").trim();
        const term = ($("mTerm") && $("mTerm").value || name).trim();
        const year = ($("mYear") && $("mYear").value || "").trim();
        const stem = String(term || name || "TERM").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 4) || "TERM";
        const yy = year ? String(year).slice(-2) : String(new Date().getFullYear()).slice(-2);
        if ($("mCode")) $("mCode").value = `${stem}${yy}..`;
      }

      function openEditor(prefill) {
        resetEditor();

        if (prefill) {
          state.isEditing = true;
          $("mTitle").textContent = "Edit Term";
          $("intakeForm").action = `/admin/admissions/intakes/${encodeURIComponent(prefill.id)}`;
          $("mName").value = prefill.name || "";
          $("mCode").value = prefill.code || "";
          if ($("mYear")) $("mYear").value = prefill.year || "";
          if ($("mTerm")) $("mTerm").value = prefill.term || prefill.name || "";
          $("mStatus").value = prefill.status || "draft";
          $("mApplicationOpenDate").value = prefill.applicationOpenDate || "";
          $("mApplicationCloseDate").value = prefill.applicationCloseDate || "";
          $("mStartDate").value = prefill.startDate || "";
          $("mEndDate").value = prefill.endDate || "";
          $("mIsActive").value = prefill.isActive ? "1" : "0";
          $("mAllowAllPrograms").value = prefill.allowAllPrograms ? "1" : "0";

          if (!prefill.allowAllPrograms && Array.isArray(prefill.programs) && prefill.programs.length) {
            prefill.programs.forEach((x) => addProgramRow(x));
          } else {
            syncProgramsJson();
          }
        }

        if (!state.isEditing) buildTermCodePreview();
        openModal("mEdit");
      }

      function openViewModal(intake) {
        if (!intake) return;

        state.currentViewId = intake.id;

        $("vName").textContent = intake.name || "—";
        $("vCode").textContent = intake.code || "—";
        if ($("vYear")) $("vYear").textContent = intake.year || "—";
        if ($("vTerm")) $("vTerm").textContent = intake.term || intake.name || "—";
        $("vStatus").innerHTML = statusPill(intake.status || "draft");
        $("vApplicationOpenDate").textContent = formatDate(intake.applicationOpenDate);
        $("vApplicationCloseDate").textContent = formatDate(intake.applicationCloseDate);
        $("vStartDate").textContent = formatDate(intake.startDate);
        $("vEndDate").textContent = formatDate(intake.endDate);
        $("vIsActive").textContent = intake.isActive ? "Yes" : "No";
        $("vApplicants").textContent = String(intake.applicants || 0);

        const host = $("vPrograms");
        host.innerHTML = "";

        if (intake.allowAllPrograms || !Array.isArray(intake.programs) || !intake.programs.length) {
          host.innerHTML = '<span class="tag"><i class="fa-solid fa-layer-group"></i> All sections</span>';
        } else {
          intake.programs.forEach((p) => {
            const span = document.createElement("span");
            span.className = "tag";
            span.innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ${escapeHtml([p.code, p.name].filter(Boolean).join(" — "))} (${escapeHtml(String(p.capacity || 0))})`;
            host.appendChild(span);
          });
        }

        openModal("mView");
      }

      function validateForm() {
        const name = $("mName").value.trim();
        const year = $("mYear") ? Number($("mYear").value || 0) : 0;
        const status = $("mStatus").value;
        const allowedStatuses = new Set(["draft", "open", "closed", "archived"]);

        if (!name || name.length < 2) {
          alert("Term name is required.");
          return false;
        }

                if (!year || year < 2000 || year > 2100) {
          alert("Academic year is required.");
          return false;
        }

        if (!allowedStatuses.has(status)) {
          alert("Invalid status.");
          return false;
        }

        const openDate = $("mApplicationOpenDate").value;
        const closeDate = $("mApplicationCloseDate").value;
        const startDate = $("mStartDate").value;
        const endDate = $("mEndDate").value;

        if (openDate && closeDate && openDate > closeDate) {
          alert("Application close date cannot be earlier than open date.");
          return false;
        }

        if (startDate && endDate && startDate > endDate) {
          alert("Study end date cannot be earlier than start date.");
          return false;
        }

        const allowAll = $("mAllowAllPrograms").value === "1";
        if (!allowAll) {
          const rows = getProgramRows();
          const seen = new Set();

          for (const row of rows) {
            if (seen.has(row.program)) {
              alert("Duplicate section rows are not allowed.");
              return false;
            }
            seen.add(row.program);

            if ((Number(row.capacity) || 0) < 0) {
              alert("Capacity cannot be negative.");
              return false;
            }
          }
        }

        return true;
      }

      function saveIntake() {
        syncProgramsJson();
        if (!validateForm()) return;
        $("intakeForm").submit();
      }

      function downloadCsv(filename, rows) {
        const esc = (value) => {
          const s = String(value ?? "");
          if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        };

        const csv = rows.map((row) => row.map(esc).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }

      function exportIntakes() {
        const rows = [
          ["Name", "Code", "Status", "ApplicationOpenDate", "ApplicationCloseDate", "StartDate", "EndDate", "IsActive", "Applicants", "Sections", "Capacity"],
          ...INTAKES.map((it) => [
            it.name || "",
            it.code || "",
            it.status || "",
            it.applicationOpenDate || "",
            it.applicationCloseDate || "",
            it.startDate || "",
            it.endDate || "",
            it.isActive ? "Yes" : "No",
            it.applicants || 0,
            it.allowAllPrograms ? "All sections" : (it.programs || []).map((p) => [p.code, p.name].filter(Boolean).join(" — ")).join(" | "),
            it.totalCapacity || 0
          ])
        ];

        downloadCsv("intakes-export.csv", rows);
      }

      $("btnCreate").addEventListener("click", function () {
        openEditor();
      });

      $("quickDraft").addEventListener("click", function () {
        openEditor();
        $("mStatus").value = "draft";
        if ($("mYear")) $("mYear").value = "";
        if ($("mTerm")) $("mTerm").value = "";
      });

      $("quickOpen").addEventListener("click", function () {
        openEditor();
        $("mStatus").value = "open";
      });

      $("btnImport").addEventListener("click", function () {
        openModal("mImport");
      });

      $("btnExport").addEventListener("click", exportIntakes);

      $("btnPrint").addEventListener("click", function () {
        window.print();
      });

      $("btnBulk").addEventListener("click", function () {
        if (!state.selected.size) return alert("Select at least one intake.");
        $("bulkbar").classList.add("show");
      });

      function bulkSubmit(status) {
        const ids = Array.from(state.selected);
        if (!ids.length) return alert("Select at least one intake.");
        $("bulkIds").value = ids.join(",");
        $("bulkStatus").value = status;
        $("bulkForm").submit();
      }

      $("bulkOpen").addEventListener("click", function () { bulkSubmit("open"); });
      $("bulkClose").addEventListener("click", function () { bulkSubmit("closed"); });
      $("bulkArchive").addEventListener("click", function () { bulkSubmit("archived"); });

      $("bulkClear").addEventListener("click", function () {
        state.selected.clear();
        renderTable();
      });

      $("checkAll").addEventListener("change", function (e) {
        if (e.target.checked) INTAKES.forEach((it) => state.selected.add(it.id));
        else INTAKES.forEach((it) => state.selected.delete(it.id));
        renderTable();
      });

      $("tbodyIntakes").addEventListener("change", function (e) {
        if (!e.target.classList.contains("rowCheck")) return;
        const id = e.target.dataset.id;
        if (e.target.checked) state.selected.add(id);
        else state.selected.delete(id);
        renderTable();
      });

      $("tbodyIntakes").addEventListener("click", function (e) {
        const tr = e.target.closest("tr[data-id]");
        if (!tr) return;

        const it = INTAKES.find((x) => x.id === tr.dataset.id);
        if (!it) return;

        if (
          e.target.closest(".rowCheck") ||
          e.target.closest(".actions") ||
          e.target.closest(".btn-xs")
        ) {
          if (e.target.closest(".actView")) return openViewModal(it);
          if (e.target.closest(".actEdit")) return openEditor(it);

          if (e.target.closest(".actSetActive")) {
            if (!window.confirm(`Set "${it.name}" as active intake?`)) return;
            return submitRowAction(`/admin/admissions/intakes/${encodeURIComponent(it.id)}/active`, "");
          }

          if (e.target.closest(".actToggle")) {
            const next = it.status === "open" ? "closed" : "open";
            if (!window.confirm(`Change "${it.name}" status to ${next}?`)) return;
            return submitRowAction(`/admin/admissions/intakes/${encodeURIComponent(it.id)}/status`, next);
          }

          if (e.target.closest(".actDelete")) {
            if (!window.confirm(`Delete "${it.name}" permanently?`)) return;
            return submitRowAction(`/admin/admissions/intakes/${encodeURIComponent(it.id)}/delete`, "");
          }

          return;
        }

        openViewModal(it);
      });

      $("viewEditBtn").addEventListener("click", function () {
        const it = INTAKES.find((x) => x.id === state.currentViewId);
        if (!it) return;
        closeModal("mView");
        openEditor(it);
      });

      $("btnAddProgramRow").addEventListener("click", function () {
        $("mAllowAllPrograms").value = "0";
        syncProgramsJson();
        addProgramRow({});
      });

      $("mAllowAllPrograms").addEventListener("change", syncProgramsJson);
      $("saveBtn").addEventListener("click", saveIntake);

      document.addEventListener("input", function (e) {
        if (e.target.matches("[data-capacity]")) syncProgramsJson();
      });

      document.addEventListener("change", function (e) {
        if (e.target.matches("[data-program]")) syncProgramsJson();
      });

      document.addEventListener("click", function (e) {
        const rm = e.target.closest("[data-remove-row]");
        if (!rm) return;
        const row = rm.closest("[data-prog-row]");
        if (row) row.remove();
        syncProgramsJson();
      });

      document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          closeModal(btn.dataset.closeModal);
        });
      });

      ["mEdit", "mView", "mImport"].forEach(function (mid) {
        const el = $(mid);
        if (!el) return;
        el.addEventListener("click", function (e) {
          if (e.target.id === mid) closeModal(mid);
        });
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") {
          document.querySelectorAll(".modal-backdrop.show").forEach(function (el) {
            el.classList.remove("show");
          });
          document.body.style.overflow = "";
        }
      });

      renderTable();
      syncProgramsJson();
    })();
