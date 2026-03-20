(function () {
  const $ = (id) => document.getElementById(id);

  function setView(view) {
    document.querySelectorAll("#viewChips .chip").forEach((b) => b.classList.remove("active"));
    const activeBtn = document.querySelector(`#viewChips .chip[data-view="${view}"]`);
    if (activeBtn) activeBtn.classList.add("active");

    const views = ["overview", "collections", "expenses"];
    views.forEach((v) => {
      const el = $(`view-${v}`);
      if (el) el.style.display = v === view ? "" : "none";
    });

    const titles = {
      overview: ["Finance Overview", "Recent finance activity from invoices, payments and expenses."],
      collections: ["Collections", "Recent student payment activity and payment methods."],
      expenses: ["Expenses", "Recent expense activity and outgoing records."],
    };

    if ($("panelTitle")) $("panelTitle").textContent = titles[view][0];
    if ($("panelSub")) $("panelSub").textContent = titles[view][1];
    if ($("resultMeta")) $("resultMeta").textContent = "Live summary";
  }

  const chips = $("viewChips");
  if (chips) {
    chips.addEventListener("click", function (e) {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      setView(btn.dataset.view);
    });
  }

  setView("overview");
})();