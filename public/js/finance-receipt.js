(() => {
  "use strict";
  document.getElementById("receiptBackBtn")?.addEventListener("click", () => history.back());
  document.getElementById("receiptPrintBtn")?.addEventListener("click", () => window.print());
})();
