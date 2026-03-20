(function () {
  const BASE = "/admin/profile";

  function $(id) {
    return document.getElementById(id);
  }

  const formEl = $("schoolForm");
  const savebar = $("savebar");
  const btnSave = $("btnSave");
  const btnSave2 = $("btnSave2");
  const btnSaveTop2 = $("btnSaveTop2");
  const btnReset = $("btnReset");
  const previewBtn = $("previewBtn");

  const logoPreview = $("logoPreview");
  const coverPreview = $("coverPreview");

  let dirty = false;

  function setDirty(v) {
    dirty = !!v;
    if (savebar) savebar.classList.toggle("show", dirty);
  }

  function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("show");
  }

  function closeModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("show");
  }

  function submitMainForm() {
    if (formEl) formEl.submit();
  }

  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(function () {
      return {};
    });

    if (!res.ok || !data.ok) {
      throw new Error(data.message || "Request failed (" + res.status + ")");
    }

    return data;
  }

  async function uploadSingle(url, fieldName, file) {
    const fd = new FormData();
    fd.append(fieldName, file);

    return fetchJson(url, {
      method: "POST",
      body: fd,
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
  }

  async function delReq(url) {
    return fetchJson(url, {
      method: "DELETE",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
  }

  async function post(url) {
    return fetchJson(url, {
      method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
  }

  function setView(v) {
    document.querySelectorAll("#viewChips .chip").forEach(function (btn) {
      btn.classList.remove("active");
    });

    const activeBtn = document.querySelector('#viewChips .chip[data-view="' + v + '"]');
    if (activeBtn) activeBtn.classList.add("active");

    ["general", "branding", "public", "trust", "seo"].forEach(function (key) {
      const view = $("view-" + key);
      if (!view) return;
      view.style.display = key === v ? "" : "none";
    });
  }

  function bindMainFormDirty() {
    if (!formEl) return;

    formEl.addEventListener("input", function () {
      setDirty(true);
    });

    formEl.addEventListener("change", function () {
      setDirty(true);
    });

    formEl.addEventListener("submit", function () {
      setDirty(false);
    });
  }

  function bindTopActions() {
    if (btnSave) {
      btnSave.addEventListener("click", function (e) {
        e.preventDefault();
        submitMainForm();
      });
    }

    if (btnSave2) {
      btnSave2.addEventListener("click", function (e) {
        e.preventDefault();
        submitMainForm();
      });
    }

    if (btnSaveTop2) {
      btnSaveTop2.addEventListener("click", function (e) {
        e.preventDefault();
        submitMainForm();
      });
    }

    if (btnReset) {
      btnReset.addEventListener("click", function (e) {
        e.preventDefault();
        location.reload();
      });
    }

    if (previewBtn) {
      previewBtn.addEventListener("click", function (e) {
        e.preventDefault();
        const code = window.__TENANT_CODE__ || "";
        if (!code) {
          alert("Tenant code missing.");
          return;
        }
        window.open("/schools/" + code, "_blank", "noopener,noreferrer");
      });
    }
  }

  function bindViewChips() {
    const chips = $("viewChips");
    if (!chips) return;

    chips.addEventListener("click", function (e) {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      setView(btn.dataset.view);
    });
  }

  function bindUploads() {
    const logoFile = $("logoFile");
    if (logoFile) {
      logoFile.addEventListener("change", async function (e) {
        try {
          const f = e.target && e.target.files && e.target.files[0];
          if (!f) return;

          const data = await uploadSingle(BASE + "/upload/logo", "logo", f);
          if (logoPreview) logoPreview.src = data.url || "";
          setDirty(true);
        } catch (err) {
          alert(err.message || "Logo upload failed");
        }
      });
    }

    const coverFile = $("coverFile");
    if (coverFile) {
      coverFile.addEventListener("change", async function (e) {
        try {
          const f = e.target && e.target.files && e.target.files[0];
          if (!f) return;

          const data = await uploadSingle(BASE + "/upload/cover", "cover", f);
          if (coverPreview) coverPreview.src = data.url || "";
          setDirty(true);
        } catch (err) {
          alert(err.message || "Cover upload failed");
        }
      });
    }

    const galleryFiles = $("galleryFiles");
    if (galleryFiles) {
      galleryFiles.addEventListener("change", async function (e) {
        try {
          const files = e.target && e.target.files ? Array.from(e.target.files) : [];
          if (!files.length) return;

          async function tryUpload(fieldName) {
            const fd = new FormData();
            files.forEach(function (f) {
              fd.append(fieldName, f);
            });

            const res = await fetch(BASE + "/upload/gallery", {
              method: "POST",
              body: fd,
              headers: { "X-Requested-With": "XMLHttpRequest" }
            });

            const data = await res.json().catch(function () {
              return {};
            });

            if (!res.ok || !data.ok) {
              throw new Error(data.message || "Upload failed (" + res.status + ")");
            }

            return data;
          }

          try {
            await tryUpload("gallery");
          } catch (err1) {
            const msg = String(err1.message || "").toLowerCase();
            if (msg.includes("unexpected field")) {
              await tryUpload("images");
            } else {
              throw err1;
            }
          }

          location.reload();
        } catch (err) {
          alert(err.message || "Gallery upload failed");
        }
      });
    }
  }

  function bindGalleryDelete() {
    Array.prototype.slice.call(document.querySelectorAll("[data-del]")).forEach(function (btn) {
      btn.addEventListener("click", async function () {
        if (!confirm("Delete this image?")) return;

        try {
          const id = btn.getAttribute("data-del");
          await delReq(BASE + "/gallery/" + id);
          location.reload();
        } catch (err) {
          alert(err.message || "Delete failed");
        }
      });
    });
  }

  function bindReviewActions() {
    Array.prototype.slice.call(document.querySelectorAll("[data-approve]")).forEach(function (btn) {
      btn.addEventListener("click", async function () {
        try {
          await post(BASE + "/reviews/" + btn.getAttribute("data-approve") + "/approve");
          location.reload();
        } catch (err) {
          alert(err.message || "Failed");
        }
      });
    });

    Array.prototype.slice.call(document.querySelectorAll("[data-reject]")).forEach(function (btn) {
      btn.addEventListener("click", async function () {
        try {
          await post(BASE + "/reviews/" + btn.getAttribute("data-reject") + "/reject");
          location.reload();
        } catch (err) {
          alert(err.message || "Failed");
        }
      });
    });

    Array.prototype.slice.call(document.querySelectorAll("[data-feature]")).forEach(function (btn) {
      btn.addEventListener("click", async function () {
        try {
          await post(BASE + "/reviews/" + btn.getAttribute("data-feature") + "/feature");
          location.reload();
        } catch (err) {
          alert(err.message || "Failed");
        }
      });
    });

    Array.prototype.slice.call(document.querySelectorAll("[data-delreview]")).forEach(function (btn) {
      btn.addEventListener("click", async function () {
        if (!confirm("Delete this review?")) return;

        try {
          await delReq(BASE + "/reviews/" + btn.getAttribute("data-delreview"));
          location.reload();
        } catch (err) {
          alert(err.message || "Failed");
        }
      });
    });
  }

  function resetFaqModal() {
    if ($("faqId")) $("faqId").value = "";
    if ($("faqQ")) $("faqQ").value = "";
    if ($("faqA")) $("faqA").value = "";
    if ($("faqModalTitle")) $("faqModalTitle").textContent = "Add FAQ";
  }

  function openFaqForCreate() {
    resetFaqModal();
    openModal("faqModal");
  }

  function openFaqForEdit(id, q, a) {
    if ($("faqId")) $("faqId").value = id || "";
    if ($("faqQ")) $("faqQ").value = q || "";
    if ($("faqA")) $("faqA").value = a || "";
    if ($("faqModalTitle")) $("faqModalTitle").textContent = "Edit FAQ";
    openModal("faqModal");
  }

  function bindFaqActions() {
    const faqAdd = $("faqAdd");
    const btnOpenFaqModal = $("btnOpenFaqModal");
    const faqFormModal = $("faqFormModal");

    if (faqAdd) {
      faqAdd.addEventListener("click", function () {
        openFaqForCreate();
      });
    }

    if (btnOpenFaqModal) {
      btnOpenFaqModal.addEventListener("click", function () {
        openFaqForCreate();
      });
    }

    if (faqFormModal) {
      faqFormModal.addEventListener("submit", async function (e) {
        e.preventDefault();

        try {
          const id = $("faqId").value.trim();
          const q = $("faqQ").value.trim();
          const a = $("faqA").value.trim();

          if (!q || !a) {
            return alert("Question and answer are required.");
          }

          if (id) {
            await fetchJson(BASE + "/faqs/" + id, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest"
              },
              body: JSON.stringify({ q, a })
            });
          } else {
            await fetchJson(BASE + "/faqs", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "XMLHttpRequest"
              },
              body: JSON.stringify({ q, a })
            });
          }

          location.reload();
        } catch (err) {
          alert(err.message || "Failed");
        }
      });
    }

    Array.prototype.slice.call(document.querySelectorAll("[data-faqdel]")).forEach(function (btn) {
      btn.addEventListener("click", async function () {
        if (!confirm("Delete this FAQ?")) return;

        try {
          await delReq(BASE + "/faqs/" + btn.getAttribute("data-faqdel"));
          location.reload();
        } catch (err) {
          alert(err.message || "Failed");
        }
      });
    });

    Array.prototype.slice.call(document.querySelectorAll("[data-faqedit]")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        const id = btn.getAttribute("data-faqedit") || "";
        const q = btn.getAttribute("data-q") || "";
        const a = btn.getAttribute("data-a") || "";
        openFaqForEdit(id, q, a);
      });
    });
  }

  function bindModalClose() {
    document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeModal(btn.dataset.closeModal);
      });
    });

    ["faqModal"].forEach(function (mid) {
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
      }
    });
  }

  function bindBeforeUnload() {
    window.addEventListener("beforeunload", function (e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindMainFormDirty();
    bindTopActions();
    bindViewChips();
    bindUploads();
    bindGalleryDelete();
    bindReviewActions();
    bindFaqActions();
    bindModalClose();
    bindBeforeUnload();
    setView("general");
  });
})();