(function () {
  const typeSelect = document.getElementById("eventType");
  const locationSelect = document.getElementById("eventLocation");
  if (!typeSelect || !locationSelect) return;

  const rows = Array.from(document.querySelectorAll("#eventsTable .event-row"));
  function applyFilters() {
    const type = typeSelect.value;
    const location = locationSelect.value;
    rows.forEach((row) => {
      const rowType = row.getAttribute("data-type") || "";
      const rowLocation = row.getAttribute("data-location") || "";
      const visible = (type === "all" || rowType === type) && (location === "all" || rowLocation === location);
      row.style.display = visible ? "" : "none";
    });
  }

  typeSelect.addEventListener("change", applyFilters);
  locationSelect.addEventListener("change", applyFilters);
})();
