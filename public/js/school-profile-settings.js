const BASE = "/admin/settings";

function $(id) {
  return document.getElementById(id);
}

const formEl = $("schoolForm");
const savebar = $("savebar");
const btnSave = $("btnSave");
const btnSave2 = $("btnSave2");
const btnReset = $("btnReset");

const logoPreview = $("logoPreview");
const coverPreview = $("coverPreview");

let dirty = false;

function setDirty(v) {
  dirty = !!v;
  if (savebar) savebar.classList.toggle("show", dirty);
}

if (formEl) {
  formEl.addEventListener("input", function () {
    setDirty(true);
  });
  formEl.addEventListener("change", function () {
    setDirty(true);
  });
}

if (btnSave) {
  btnSave.addEventListener("click", function (e) {
    e.preventDefault();
    if (formEl) formEl.submit();
  });
}

if (btnSave2) {
  btnSave2.addEventListener("click", function (e) {
    e.preventDefault();
    if (formEl) formEl.submit();
  });
}

if (btnReset) {
  btnReset.addEventListener("click", function (e) {
    e.preventDefault();
    location.reload();
  });
}

const previewBtn = $("previewBtn");
if (previewBtn) {
  previewBtn.addEventListener("click", function () {
    window.open("/schools/" + (window.__TENANT_CODE__ || ""), "_blank");
  });
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
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
}

async function delReq(url) {
  return fetchJson(url, {
    method: "DELETE",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
}

async function post(url) {
  return fetchJson(url, {
    method: "POST",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
}

// LOGO upload
const logoFile = $("logoFile");
if (logoFile) {
  logoFile.addEventListener("change", async function (e) {
    try {
      const f = e.target && e.target.files ? e.target.files[0] : null;
      if (!f) return;

      const data = await uploadSingle(BASE + "/upload/logo", "logo", f);
      if (logoPreview) logoPreview.src = data.url || "";
      setDirty(true);
    } catch (err) {
      alert(err.message || "Upload failed");
    }
  });
}

// COVER upload
const coverFile = $("coverFile");
if (coverFile) {
  coverFile.addEventListener("change", async function (e) {
    try {
      const f = e.target && e.target.files ? e.target.files[0] : null;
      if (!f) return;

      const data = await uploadSingle(BASE + "/upload/cover", "cover", f);
      if (coverPreview) coverPreview.src = data.url || "";
      setDirty(true);
    } catch (err) {
      alert(err.message || "Upload failed");
    }
  });
}

// GALLERY upload (auto-retry field name)
const galleryFiles = $("galleryFiles");
if (galleryFiles) {
  galleryFiles.addEventListener("change", async function (e) {
    try {
      const files =
        e.target && e.target.files ? Array.from(e.target.files) : [];
      if (!files.length) return;

      async function tryUpload(fieldName) {
        const fd = new FormData();
        files.forEach(function (f) {
          fd.append(fieldName, f);
        });

        const res = await fetch(BASE + "/upload/gallery", {
          method: "POST",
          body: fd,
          headers: { "X-Requested-With": "XMLHttpRequest" },
        });

        const data = await res.json().catch(function () {
          return {};
        });
        if (!res.ok || !data.ok) {
          const msg = data.message || "Upload failed (" + res.status + ")";
          const err = new Error(msg);
          err._raw = data;
          throw err;
        }
        return data;
      }

      // ✅ first try "gallery"
      try {
        await tryUpload("gallery");
        location.reload();
        return;
      } catch (err1) {
        // if multer expects a different field like "images", retry
        const m = err1 && err1.message ? String(err1.message) : "";
        if (m.toLowerCase().indexOf("unexpected field") !== -1) {
          await tryUpload("images");
          location.reload();
          return;
        }
        throw err1;
      }
    } catch (err) {
      alert(err.message || "Upload failed");
    }
  });
}

// Delete gallery
Array.prototype.slice
  .call(document.querySelectorAll("[data-del]"))
  .forEach(function (btn) {
    btn.addEventListener("click", async function () {
      if (!confirm("Delete this image?")) return;
      try {
        await delReq(BASE + "/gallery/" + btn.getAttribute("data-del"));
        location.reload();
      } catch (err) {
        alert(err.message || "Delete failed");
      }
    });
  });

// Reviews moderation
Array.prototype.slice
  .call(document.querySelectorAll("[data-approve]"))
  .forEach(function (b) {
    b.addEventListener("click", async function () {
      try {
        await post(
          BASE + "/reviews/" + b.getAttribute("data-approve") + "/approve",
        );
        location.reload();
      } catch (e) {
        alert(e.message || "Failed");
      }
    });
  });

Array.prototype.slice
  .call(document.querySelectorAll("[data-reject]"))
  .forEach(function (b) {
    b.addEventListener("click", async function () {
      try {
        await post(
          BASE + "/reviews/" + b.getAttribute("data-reject") + "/reject",
        );
        location.reload();
      } catch (e) {
        alert(e.message || "Failed");
      }
    });
  });

Array.prototype.slice
  .call(document.querySelectorAll("[data-feature]"))
  .forEach(function (b) {
    b.addEventListener("click", async function () {
      try {
        await post(
          BASE + "/reviews/" + b.getAttribute("data-feature") + "/feature",
        );
        location.reload();
      } catch (e) {
        alert(e.message || "Failed");
      }
    });
  });

Array.prototype.slice
  .call(document.querySelectorAll("[data-delreview]"))
  .forEach(function (b) {
    b.addEventListener("click", async function () {
      if (!confirm("Delete this review?")) return;
      try {
        await delReq(BASE + "/reviews/" + b.getAttribute("data-delreview"));
        location.reload();
      } catch (e) {
        alert(e.message || "Failed");
      }
    });
  });

// FAQ add
const faqAdd = $("faqAdd");
if (faqAdd) {
  faqAdd.addEventListener("click", async function () {
    try {
      const qEl = $("faqQ");
      const aEl = $("faqA");
      const q = qEl ? qEl.value.trim() : "";
      const a = aEl ? aEl.value.trim() : "";
      if (!q || !a) return alert("Question and Answer required.");

      await fetchJson(BASE + "/faqs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ q: q, a: a }),
      });

      location.reload();
    } catch (e) {
      alert(e.message || "Failed");
    }
  });
}

// FAQ delete
Array.prototype.slice
  .call(document.querySelectorAll("[data-faqdel]"))
  .forEach(function (b) {
    b.addEventListener("click", async function () {
      if (!confirm("Delete this FAQ?")) return;
      try {
        await delReq(BASE + "/faqs/" + b.getAttribute("data-faqdel"));
        location.reload();
      } catch (e) {
        alert(e.message || "Failed");
      }
    });
  });

// FAQ edit
Array.prototype.slice
  .call(document.querySelectorAll("[data-faqedit]"))
  .forEach(function (b) {
    b.addEventListener("click", async function () {
      try {
        const id = b.getAttribute("data-faqedit");
        const oldQ = b.getAttribute("data-q") || "";
        const oldA = b.getAttribute("data-a") || "";

        const q = prompt("Edit question:", oldQ);
        if (q === null) return;

        const a = prompt("Edit answer:", oldA);
        if (a === null) return;

        await fetchJson(BASE + "/faqs/" + id, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({ q: q, a: a }),
        });

        location.reload();
      } catch (e) {
        alert(e.message || "Failed");
      }
    });
  });

window.addEventListener("beforeunload", function (e) {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = "";
});
