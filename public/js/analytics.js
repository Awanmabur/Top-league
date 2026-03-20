(function () {
  const $ = (id) => document.getElementById(id);

  function readAnalyticsData() {
    const el = $("analyticsData");
    if (!el) return {};
    try {
      return JSON.parse(el.textContent || "{}");
    } catch (err) {
      console.error("Failed to parse analytics data:", err);
      return {};
    }
  }

  const DATA = readAnalyticsData();
  const query = DATA.query || {};
  const trends = DATA.trends || {};
  const feeBreakdown = Array.isArray(DATA.feeBreakdown) ? DATA.feeBreakdown : [];
  const programRows = Array.isArray(DATA.programRows) ? DATA.programRows : [];

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function makeLineChart(canvasId, labels, values, labelText) {
    const el = $(canvasId);
    if (!el || typeof Chart === "undefined") return null;

    return new Chart(el, {
      type: "line",
      data: {
        labels: labels || [],
        datasets: [
          {
            label: labelText,
            data: values || [],
            borderWidth: 2,
            fill: true,
            tension: 0.35,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        responsive: true,
        animation: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: true },
        },
        scales: {
          x: {
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
          },
        },
      },
    });
  }

  function makeBarChart(canvasId, labels, values, labelText) {
    const el = $(canvasId);
    if (!el || typeof Chart === "undefined") return null;

    return new Chart(el, {
      type: "bar",
      data: {
        labels: labels || [],
        datasets: [
          {
            label: labelText,
            data: values || [],
            borderWidth: 1,
            borderRadius: 8,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        responsive: true,
        animation: false,
        plugins: {
          legend: { display: true },
        },
        scales: {
          x: {
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
          },
        },
      },
    });
  }

  function makeDoughnutChart(canvasId, labels, values) {
    const el = $(canvasId);
    if (!el || typeof Chart === "undefined") return null;
    if (!labels.length || !values.length) return null;

    return new Chart(el, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data: values,
            borderWidth: 1,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        responsive: true,
        animation: false,
        plugins: {
          legend: {
            position: "bottom",
          },
        },
      },
    });
  }

  function initTabs() {
    const buttons = document.querySelectorAll(".tabbtn");
    const panes = document.querySelectorAll(".pane");

    buttons.forEach((btn) => {
      btn.addEventListener("click", function () {
        const target = btn.dataset.pane;
        if (!target) return;

        buttons.forEach((b) => b.classList.remove("active"));
        panes.forEach((p) => p.classList.remove("active"));

        btn.classList.add("active");
        const pane = document.getElementById(target);
        if (pane) pane.classList.add("active");
      });
    });
  }

  function initTopActions() {
    const btnPrint = $("btnPrint");
    const btnExport = $("btnExport");
    const btnShare = $("btnShare");

    if (btnPrint) {
      btnPrint.addEventListener("click", function () {
        window.print();
      });
    }

    if (btnExport) {
      btnExport.addEventListener("click", function () {
        const qs = new URLSearchParams(window.location.search);
        window.location.href = "/admin/analytics/export?" + qs.toString();
      });
    }

    if (btnShare) {
      btnShare.addEventListener("click", async function () {
        try {
          await navigator.clipboard.writeText(window.location.href);
          alert("Link copied.");
        } catch (err) {
          alert("Copy failed. Please copy the URL manually.");
        }
      });
    }
  }

  function initProgramSearch() {
    const search = $("search");
    const resultMeta = $("programResultMeta");
    const rows = Array.from(document.querySelectorAll("#programTable tbody tr[data-label]"));

    if (!search || !rows.length) return;

    const applySearch = function () {
      const value = String(search.value || "").trim().toLowerCase();
      let visible = 0;

      rows.forEach((row) => {
        const label = String(row.dataset.label || "");
        const show = !value || label.includes(value);
        row.style.display = show ? "" : "none";
        if (show) visible += 1;
      });

      if (resultMeta) {
        resultMeta.textContent = `${visible} row(s)`;
      }
    };

    search.addEventListener("input", applySearch);
    applySearch();
  }

  function initCharts() {
    const appLabels = Array.isArray(trends.applications?.labels) ? trends.applications.labels : [];
    const appValues = Array.isArray(trends.applications?.values) ? trends.applications.values : [];

    const payLabels = Array.isArray(trends.payments?.labels) ? trends.payments.labels : [];
    const payValues = Array.isArray(trends.payments?.values) ? trends.payments.values : [];

    makeLineChart("chartApplications", appLabels, appValues, "Applications");
    makeLineChart("chartPayments", payLabels, payValues, "Payments");

    makeDoughnutChart(
      "chartFees",
      feeBreakdown.map((x) => x.label || "Other"),
      feeBreakdown.map((x) => Number(x.amount || 0))
    );

    const topPrograms = [...programRows]
      .sort((a, b) => Number(b.students || 0) - Number(a.students || 0))
      .slice(0, 10);

    makeBarChart(
      "chartPrograms",
      topPrograms.map((x) => x.label || "Program"),
      topPrograms.map((x) => Number(x.students || 0)),
      "Students"
    );
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTabs();
    initTopActions();
    initProgramSearch();
    initCharts();
  });
})();