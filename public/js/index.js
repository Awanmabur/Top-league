(() => {
  function el(id) {
    return document.getElementById(id);
  }

  function getDashboardData() {
    const node = el("dashboard-json");
    if (!node) return {};
    try {
      return JSON.parse(node.textContent || "{}");
    } catch (err) {
      console.error("Failed to parse dashboard JSON:", err);
      return {};
    }
  }

  const DASHBOARD = getDashboardData();

  function drawSpark(canvasId, data, color = "#0a6fbf") {
    const c = el(canvasId);
    if (!c || !Array.isArray(data) || !data.length) return;

    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 160;
    const h = c.clientHeight || 56;

    c.width = w * dpr;
    c.height = h * dpr;

    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const max = Math.max(...data);
    const min = Math.min(...data);
    const pad = 6;
    const range = max - min || 1;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    data.forEach((v, i) => {
      const x = pad + (i * (w - 2 * pad)) / Math.max(1, data.length - 1);
      const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
  }

  function drawDonut(svgId, data) {
    const svg = el(svgId);
    if (!svg || !Array.isArray(data) || !data.length) return;

    const total = data.reduce((s, i) => s + (Number(i.val) || 0), 0) || 1;
    let angle = 0;
    const cx = 21;
    const cy = 21;
    const r = 15;

    svg.innerHTML = "";

    data.forEach((d) => {
      const portion = (Number(d.val) || 0) / total;
      const start = angle * Math.PI * 2;
      angle += portion;
      const end = angle * Math.PI * 2;

      const x1 = cx + r * Math.cos(start);
      const y1 = cy + r * Math.sin(start);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const large = portion > 0.5 ? 1 : 0;

      svg.insertAdjacentHTML(
        "beforeend",
        `<path d="M${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z" fill="${d.color || "#0a6fbf"}"></path>`
      );
    });

    svg.insertAdjacentHTML(
      "beforeend",
      `<circle cx="${cx}" cy="${cy}" r="${r * 0.6}" fill="white"></circle>`
    );
  }

  function drawDept(svgId, data) {
    const svg = el(svgId);
    if (!svg || !Array.isArray(data) || !data.length) return;

    const w = svg.clientWidth || 600;
    const h = svg.clientHeight || 180;
    const pad = 40;

    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = "";

    const max = Math.max(...data.map((d) => Number(d.val) || 0), 1);
    const barW = (w - pad * 2) / Math.max(1, data.length);

    data.forEach((d, i) => {
      const bw = barW * 0.6;
      const x = pad + i * barW + (barW - bw) / 2;
      const barH = ((Number(d.val) || 0) / max) * (h - pad - 25);
      const y = h - pad - barH;

      svg.insertAdjacentHTML(
        "beforeend",
        `<rect x="${x}" y="${y}" width="${bw}" height="${barH}" rx="6" fill="#0a6fbf"></rect>
         <text x="${x + bw / 2}" y="${h - 12}" font-size="11" text-anchor="middle" fill="#6b7280">
           ${((d.name || "").split(" ")[0] || "Dept")}
         </text>`
      );
    });
  }

  function drawRevenue() {
    const c = el("revenueChart");
    if (!c || !Array.isArray(DASHBOARD.revenue) || !DASHBOARD.revenue.length) return;

    const data = DASHBOARD.revenue;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 300;
    const h = c.clientHeight || 220;

    c.width = w * dpr;
    c.height = h * dpr;

    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const max = Math.max(...data);
    const min = Math.min(...data);
    const pad = 24;
    const range = max - min || 1;

    ctx.beginPath();
    ctx.strokeStyle = "#0a6fbf";
    ctx.lineWidth = 2.6;

    data.forEach((v, i) => {
      const x = pad + (i * (w - 2 * pad)) / Math.max(1, data.length - 1);
      const y = pad + (1 - (v - min) / range) * (h - 2 * pad);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();

    ctx.lineTo(w - pad, h - pad);
    ctx.lineTo(pad, h - pad);
    ctx.closePath();
    ctx.fillStyle = "rgba(10,111,191,0.08)";
    ctx.fill();
  }

  function populateCountriesLegend() {
    const legend = el("countriesLegend");
    if (!legend) return;

    legend.innerHTML = "";
    (DASHBOARD.countries || []).forEach((c) => {
      const row = document.createElement("div");
      row.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center">
          <span style="width:12px;height:12px;background:${c.color || "#0a6fbf"};display:inline-block;border-radius:3px"></span>
          <strong style="width:120px">${c.country || "Unknown"}</strong>
          <span style="color:var(--muted);font-size:12px">${c.val || 0}%</span>
        </div>
      `;
      legend.appendChild(row);
    });
  }

  function populateRecentStudents() {
    const rs = el("recentStudents");
    if (!rs) return;

    rs.innerHTML = "";

    (DASHBOARD.recentStudents || []).forEach((s) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${s.name || "—"}</strong></td>
        <td>${s.program || "—"}</td>
        <td>${s.status || "—"}</td>
        <td class="right">${s.balance || "0"}</td>
      `;
      rs.appendChild(tr);
    });

    if (!(DASHBOARD.recentStudents || []).length) {
      rs.innerHTML = `<tr><td colspan="4" class="muted">No students found</td></tr>`;
    }
  }

  function populatePendingApps() {
    const pa = el("pendingAppsTable");
    if (!pa) return;

    pa.innerHTML = "";

    (DASHBOARD.pendingApps || []).forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.name || "—"}</td>
        <td>${p.program || "—"}</td>
        <td>${p.country || "—"}</td>
        <td class="right">
          <a href="/admin/applications/${p.id || ""}" class="btn secondary" style="padding:6px 8px;font-size:13px">Review</a>
        </td>
      `;
      pa.appendChild(tr);
    });

    if (!(DASHBOARD.pendingApps || []).length) {
      pa.innerHTML = `<tr><td colspan="4" class="muted">No pending applications</td></tr>`;
    }
  }

  function activateCurrentLinks() {
    const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
    const allLinks = document.querySelectorAll("a[href]");

    allLinks.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

      let linkPath;
      try {
        linkPath = new URL(href, window.location.origin).pathname.replace(/\/+$/, "") || "/";
      } catch {
        return;
      }

      if (
        linkPath === currentPath ||
        (linkPath !== "/" && currentPath.startsWith(linkPath))
      ) {
        link.classList.add("active");
        const parent = link.closest(".nav-item, .menu-item, li, .tab-link, .sidebar-link");
        if (parent) parent.classList.add("active");
      }
    });
  }

  function renderAll() {
    drawDonut("donutCountries", DASHBOARD.countries || []);
    populateCountriesLegend();
    drawDept("deptChart", DASHBOARD.departments || []);
    drawSpark("studentsTrend", DASHBOARD.studentsTrend || []);
    drawSpark("appsTrend", DASHBOARD.appsTrend || [], "#8b5cf6");
    drawSpark("feesTrend", DASHBOARD.feesTrend || [], "#fb923c");
    drawSpark("uptimeTrend", DASHBOARD.uptimeTrend || [], "#16a34a");
    drawRevenue();
    populateRecentStudents();
    populatePendingApps();
    activateCurrentLinks();
  }

  window.addEventListener("load", () => {
    renderAll();
    window.addEventListener("resize", renderAll);
  });
})();