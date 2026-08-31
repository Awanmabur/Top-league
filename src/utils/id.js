const crypto = require("crypto");

function randDigits(n = 8) {
  let s = "";
  for (let i = 0; i < n; i += 1) s += crypto.randomInt(0, 10);
  return s;
}

/**
 * Example: APP-2026-48102937
 */
function makeApplicationId(now = new Date()) {
  const y = now.getUTCFullYear();
  return `APP-${y}-${randDigits(8)}`;
}

module.exports = { makeApplicationId, randDigits };
