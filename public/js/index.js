(() => {
  function el(id) {
    return document.getElementById(id);
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  function clearNode(node) {
    if (node) node.replaceChildren();
  }

  function safeColor(value, fallback = "#0a6fbf") {
    const color = String(value || "").trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : fallback;
  }

  function makeCell(text, className = "") {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = String(text ?? "");
    return td;
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

    const total = data.reduce((sum, item) => sum + (Number(item.val) || 0), 0) || 1;
    let angle = 0;
    const cx = 21;
    const cy = 21;
    const r = 15;

    clearNode(svg);

    data.forEach((item) => {
      const portion = Math.max(0, Number(item.val) || 0) / total;
      const startAngle = angle * Math.PI * 2;
      angle += portion;
      const endAngle = angle * Math.PI * 2;

      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const large = portion > 0.5 ? 1 : 0;

      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", `M${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`);
      path.setAttribute("fill", safeColor(item.color));
      svg.appendChild(path);
    });

    const center = document.createElementNS(SVG_NS, "circle");
    center.setAttribute("cx", String(cx));
    center.setAttribute("cy", String(cy));
    center.setAttribute("r", String(r * 0.6));
    center.setAttribute("fill", "white");
    svg.appendChild(center);
  }

  function drawDept(svgId, data) {
    const svg = el(svgId);
    if (!svg || !Array.isArray(data) || !data.length) return;

    const w = svg.clientWidth || 600;
    const h = svg.clientHeight || 180;
    const pad = 40;

    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    clearNode(svg);

    const max = Math.max(...data.map((item) => Number(item.val) || 0), 1);
    const barW = (w - pad * 2) / Math.max(1, data.length);

    data.forEach((item, index) => {
      const bw = barW * 0.6;
      const x = pad + index * barW + (barW - bw) / 2;
      const barH = ((Number(item.val) || 0) / max) * (h - pad - 25);
      const y = h - pad - barH;

      const rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(bw));
      rect.setAttribute("height", String(barH));
      rect.setAttribute("rx", "6");
      rect.setAttribute("fill", "#0a6fbf");
      svg.appendChild(rect);

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", String(x + bw / 2));
      label.setAttribute("y", String(h - 12));
      label.setAttribute("font-size", "11");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("fill", "#6b7280");
      label.textContent = String(item.name || "").split(" ")[0] || "Dept";
      svg.appendChild(label);
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

    clearNode(legend);
    (DASHBOARD.countries || []).forEach((country) => {
      const row = document.createElement("div");
      const content = document.createElement("div");
      content.style.display = "flex";
      content.style.gap = "8px";
      content.style.alignItems = "center";

      const swatch = document.createElement("span");
      swatch.style.width = "12px";
      swatch.style.height = "12px";
      swatch.style.background = safeColor(country.color);
      swatch.style.display = "inline-block";
      swatch.style.borderRadius = "3px";

      const name = document.createElement("strong");
      name.style.width = "120px";
      name.textContent = String(country.country || "Unknown");

      const value = document.createElement("span");
      value.style.color = "var(--muted)";
      value.style.fontSize = "12px";
      value.textContent = `${Number(country.val || 0)}%`;

      content.append(swatch, name, value);
      row.appendChild(content);
      legend.appendChild(row);
    });
  }

  function populateRecentStudents() {
    const table = el("recentStudents");
    if (!table) return;

    clearNode(table);
    const students = DASHBOARD.recentStudents || [];
    students.forEach((student) => {
      const tr = document.createElement("tr");
      const nameCell = makeCell("");
      const strong = document.createElement("strong");
      strong.textContent = String(student.name || "-");
      nameCell.appendChild(strong);
      tr.append(
        nameCell,
        makeCell(student.group || student.program || "-"),
        makeCell(student.status || "-"),
        makeCell(student.balance || "0", "right"),
      );
      table.appendChild(tr);
    });

    if (!students.length) {
      const tr = document.createElement("tr");
      const td = makeCell("No students found", "muted");
      td.colSpan = 4;
      tr.appendChild(td);
      table.appendChild(tr);
    }
  }

  function populatePendingApps() {
    const table = el("pendingAppsTable");
    if (!table) return;

    clearNode(table);
    const applications = DASHBOARD.pendingApps || [];
    applications.forEach((application) => {
      const tr = document.createElement("tr");
      const actionCell = makeCell("", "right");
      const link = document.createElement("a");
      link.href = `/admin/admissions/applicants/${encodeURIComponent(String(application.id || ""))}`;
      link.className = "btn secondary";
      link.style.padding = "6px 8px";
      link.style.fontSize = "13px";
      link.textContent = "Review";
      actionCell.appendChild(link);

      tr.append(
        makeCell(application.name || "-"),
        makeCell(application.group || application.program || "-"),
        makeCell(application.country || "-"),
        actionCell,
      );
      table.appendChild(tr);
    });

    if (!applications.length) {
      const tr = document.createElement("tr");
      const td = makeCell("No pending applications", "muted");
      td.colSpan = 4;
      tr.appendChild(td);
      table.appendChild(tr);
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
