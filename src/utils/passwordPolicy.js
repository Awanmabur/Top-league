function validatePasswordStrength(password, options = {}) {
  const minLength = Number(options.minLength || 10);
  const value = String(password || "");

  if (value.length < minLength) {
    return `Password must be at least ${minLength} characters long.`;
  }

  if (!/[A-Z]/.test(value)) {
    return "Password must include at least one uppercase letter.";
  }

  if (!/[a-z]/.test(value)) {
    return "Password must include at least one lowercase letter.";
  }

  if (!/[0-9]/.test(value)) {
    return "Password must include at least one number.";
  }

  if (!/[^A-Za-z0-9]/.test(value)) {
    return "Password must include at least one symbol.";
  }

  return "";
}

function isStrongPassword(password, options = {}) {
  return !validatePasswordStrength(password, options);
}

module.exports = {
  validatePasswordStrength,
  isStrongPassword,
};
