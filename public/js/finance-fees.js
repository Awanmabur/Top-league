(function () {
  function toNum(v) {
    var n = Number(v || 0);
    return isNaN(n) ? 0 : n;
  }

  function fmt(n) {
    try { return Number(n || 0).toLocaleString(); } catch (e) { return String(n || 0); }
  }

  function calcTotal() {
    var totalEl = document.getElementById("feeTotal");
    var table = document.getElementById("feeItemsTable");
    if (!totalEl || !table) return;

    var currency = table.getAttribute("data-currency") || "UGX";

    var sum = 0;
    var inputs = document.querySelectorAll(".js-amount");
    for (var i = 0; i < inputs.length; i++) sum += toNum(inputs[i].value);

    totalEl.textContent = currency + " " + fmt(sum);
  }

  function addRow() {
    var body = document.getElementById("feeItemsBody");
    if (!body) return;

    var tr = document.createElement("tr");
    tr.innerHTML = [
      '<td><input name="itemCode" value="" placeholder="tuition"/></td>',
      '<td><input name="itemTitle" value="" placeholder="Tuition"/></td>',
      '<td><input name="itemAmount" value="0" type="number" min="0" step="1" class="js-amount"/></td>',
      '<td style="text-align:center"><input name="itemRequired" type="checkbox" checked /></td>',
      '<td><input name="itemNotes" value="" placeholder="Optional"/></td>',
      '<td><button class="btn light js-remove-row" type="button"><i class="fa-solid fa-trash"></i></button></td>'
    ].join("");

    body.appendChild(tr);
    calcTotal();
  }

  function onClick(e) {
    var t = e.target;
    if (!t) return;

    // remove row
    var btn = t.closest ? t.closest(".js-remove-row") : null;
    if (btn) {
      var row = btn.closest("tr");
      if (row && row.parentNode) row.parentNode.removeChild(row);
      calcTotal();
      return;
    }
  }

  function onInput(e) {
    var t = e.target;
    if (!t) return;
    if (t.classList && t.classList.contains("js-amount")) calcTotal();
  }

  document.addEventListener("click", function (e) {
    var add = e.target && (e.target.id === "btnAddItem" ? e.target : (e.target.closest ? e.target.closest("#btnAddItem") : null));
    if (add) {
      e.preventDefault();
      addRow();
      return;
    }
    onClick(e);
  });

  document.addEventListener("input", onInput);
  document.addEventListener("DOMContentLoaded", calcTotal);
})();
