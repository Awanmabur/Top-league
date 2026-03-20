function randDigits(n = 6) {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

/**
 * Example: APP-2026-481029
 */
function makeApplicationId() {
  const y = new Date().getFullYear();
  return `APP-${y}-${randDigits(6)}`;
}

module.exports = { makeApplicationId };
