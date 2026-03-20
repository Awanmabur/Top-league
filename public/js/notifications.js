(function () {
  function $(id) {
    return document.getElementById(id);
  }

  var state = {
    selected: {}
  };

  function getSelectedIds() {
    var ids = [];
    var key;
    for (key in state.selected) {
      if (Object.prototype.hasOwnProperty.call(state.selected, key) && state.selected[key]) {
        ids.push(key);
      }
    }
    return ids;
  }

  function updateBulkBar() {
    var ids = getSelectedIds();

    if ($("selCount")) $("selCount").textContent = String(ids.length);
    if ($("bulkbar")) $("bulkbar").classList.toggle("show", ids.length > 0);

    if ($("checkAll")) {
      var checks = document.querySelectorAll(".rowCheck");
      var total = checks.length;
      var checked = document.querySelectorAll(".rowCheck:checked").length;
      $("checkAll").checked = total > 0 && total === checked;
    }
  }

  function openModal(id) {
    var el = $(id);
    if (!el) return;
    el.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    var el = $(id);
    if (!el) return;
    el.classList.remove("show");

    if (!document.querySelector(".modal-backdrop.show")) {
      document.body.style.overflow = "";
    }
  }

  function closeAllModals() {
    var modals = document.querySelectorAll(".modal-backdrop.show");
    modals.forEach(function (el) {
      el.classList.remove("show");
    });
    document.body.style.overflow = "";
  }

  function submitRowAction(url) {
    var form = $("rowActionForm");
    if (!form) return;
    form.action = url;
    form.submit();
  }

  function submitBulk(action) {
    var ids = getSelectedIds();

    if (!ids.length) {
      alert("Select at least one notification.");
      return;
    }

    if (action === "delete" && !window.confirm("Delete " + ids.length + " selected notification(s)?")) {
      return;
    }

    $("bulkAction").value = action;
    $("bulkIds").value = ids.join(",");
    $("bulkForm").submit();
  }

  function saveNotification() {
    var title = $("mTitleInput").value.trim();
    var message = $("mMessage").value.trim();
    var deliverAt = $("mDeliverAt").value;
    var expiresAt = $("mExpiresAt").value;

    if (!title) {
      alert("Title is required.");
      return;
    }

    if (!message) {
      alert("Message is required.");
      return;
    }

    if (deliverAt && expiresAt && new Date(expiresAt) <= new Date(deliverAt)) {
      alert("Expiry date must be after delivery date.");
      return;
    }

    $("notificationForm").submit();
  }

  function updateCounters() {
    if ($("titleCount")) {
      $("titleCount").textContent = $("mTitleInput").value.length + " / 160";
    }
    if ($("messageCount")) {
      $("messageCount").textContent = $("mMessage").value.length + " / 2000";
    }
  }

  function fillCreateForm(data) {
    data = data || {};

    $("notificationForm").action = "/admin/notifications/new";
    $("mTitle").textContent = "New Notification";
    $("mAudience").value = data.audience || "admin";
    $("mType").value = data.type || "info";
    $("mUrl").value = data.url || "";
    $("mDeliverAt").value = data.deliverAt || "";
    $("mExpiresAt").value = data.expiresAt || "";
    $("mTitleInput").value = data.title || "";
    $("mMessage").value = data.message || "";

    updateCounters();
    openModal("mEdit");
  }

  function exportTableToCsv() {
    var rows = [];
    var trs = document.querySelectorAll("#tbodyNotifications tr[data-id]");

    rows.push(["Title", "Message", "Type", "Audience", "URL", "CreatedAt", "DeliverAt", "ExpiresAt", "Status"]);

    trs.forEach(function (tr) {
      rows.push([
        tr.getAttribute("data-title") || "",
        tr.getAttribute("data-message") || "",
        tr.getAttribute("data-type") || "",
        tr.getAttribute("data-audience") || "",
        tr.getAttribute("data-url") || "",
        tr.getAttribute("data-created") || "",
        tr.getAttribute("data-deliver") || "",
        tr.getAttribute("data-expires") || "",
        tr.getAttribute("data-status") || ""
      ]);
    });

    function esc(value) {
      var s = String(value == null ? "" : value);
      if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }

    var csv = rows.map(function (row) {
      return row.map(esc).join(",");
    }).join("\n");

    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");

    a.href = url;
    a.download = "notifications-export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  document.addEventListener("change", function (e) {
    if (e.target.id === "checkAll") {
      var checked = e.target.checked;

      document.querySelectorAll(".rowCheck").forEach(function (cb) {
        cb.checked = checked;
        state.selected[cb.getAttribute("data-id")] = checked;
      });

      updateBulkBar();
      return;
    }

    if (e.target.classList.contains("rowCheck")) {
      state.selected[e.target.getAttribute("data-id")] = e.target.checked;
      updateBulkBar();
    }
  });

  document.addEventListener("click", function (e) {
    var target;

    target = e.target.closest("[data-close-modal]");
    if (target) {
      closeModal(target.getAttribute("data-close-modal"));
      return;
    }

    target = e.target.closest("#btnCreate");
    if (target) {
      fillCreateForm();
      return;
    }

    target = e.target.closest("#quickAdmin");
    if (target) {
      fillCreateForm({ audience: "admin", type: "info" });
      return;
    }

    target = e.target.closest("#quickStaff");
    if (target) {
      fillCreateForm({ audience: "staff", type: "info" });
      return;
    }

    target = e.target.closest("#quickStudent");
    if (target) {
      fillCreateForm({ audience: "student", type: "info" });
      return;
    }

    target = e.target.closest("#btnImport");
    if (target) {
      openModal("mImport");
      return;
    }

    target = e.target.closest("#btnExport");
    if (target) {
      exportTableToCsv();
      return;
    }

    target = e.target.closest("#btnPrint");
    if (target) {
      window.print();
      return;
    }

    target = e.target.closest("#btnBulk");
    if (target) {
      if (!getSelectedIds().length) {
        alert("Select at least one notification.");
        return;
      }
      $("bulkbar").classList.add("show");
      return;
    }

    target = e.target.closest("#saveBtn");
    if (target) {
      saveNotification();
      return;
    }

    target = e.target.closest("#bulkRead");
    if (target) {
      submitBulk("read");
      return;
    }

    target = e.target.closest("#bulkUnread");
    if (target) {
      submitBulk("unread");
      return;
    }

    target = e.target.closest("#bulkDelete");
    if (target) {
      submitBulk("delete");
      return;
    }

    target = e.target.closest("#bulkClear");
    if (target) {
      state.selected = {};
      document.querySelectorAll(".rowCheck").forEach(function (cb) {
        cb.checked = false;
      });
      updateBulkBar();
      return;
    }

    var row = e.target.closest("tr[data-id]");
    if (!row) return;

    if (e.target.closest(".rowCheck")) return;

    if (e.target.closest(".actView")) {
      $("vType").textContent = row.getAttribute("data-type-label") || "—";
      $("vAudience").textContent = row.getAttribute("data-audience") || "—";
      $("vStatus").textContent = row.getAttribute("data-status-label") || "—";
      $("vCreated").textContent = row.getAttribute("data-created-label") || "—";
      $("vDeliverAt").textContent = row.getAttribute("data-deliver-label") || "—";
      $("vExpiresAt").textContent = row.getAttribute("data-expires-label") || "—";
      $("vTitle").textContent = row.getAttribute("data-title") || "—";
      $("vMessage").textContent = row.getAttribute("data-message") || "—";

      var url = row.getAttribute("data-url") || "";
      if (url) {
        $("vLink").innerHTML = '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + "</a>";
      } else {
        $("vLink").textContent = "—";
      }

      openModal("mView");
      return;
    }

    if (e.target.closest(".actToggleRead")) {
      submitRowAction(
        "/admin/notifications/" +
          encodeURIComponent(row.getAttribute("data-id")) +
          "/" +
          row.getAttribute("data-next-read")
      );
      return;
    }

    if (e.target.closest(".actDelete")) {
      var title = row.getAttribute("data-title") || "this notification";
      if (!window.confirm('Delete "' + title + '"?')) return;

      submitRowAction("/admin/notifications/" + encodeURIComponent(row.getAttribute("data-id")) + "/delete");
      return;
    }

    if (!e.target.closest(".actions")) {
      var viewBtn = row.querySelector(".actView");
      if (viewBtn) viewBtn.click();
    }
  });

  document.addEventListener("input", function (e) {
    if (e.target.id === "mTitleInput" || e.target.id === "mMessage") {
      updateCounters();
    }
  });

  ["mEdit", "mView", "mImport"].forEach(function (id) {
    var el = $(id);
    if (!el) return;

    el.addEventListener("click", function (e) {
      if (e.target === el) {
        closeModal(id);
      }
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeAllModals();
    }
  });

  updateCounters();
  updateBulkBar();
})();