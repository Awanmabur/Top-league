const crypto = require('crypto');

/**
 * REG format: REG/2026/000123
 * Uses an atomic Counter when available. A cryptographic suffix is used only
 * if a historical collision is encountered; non-cryptographic randomness is never used.
 */
async function nextRegNo(models) {
  const { Counter, Student } = models || {};
  if (!Counter || !Student) throw new Error('Counter and Student models are required for nextRegNo.');

  const year = new Date().getFullYear();
  const key = `regno:${year}`;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const counter = await Counter.findOneAndUpdate(
      { key },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const seq = String(counter.seq).padStart(6, '0');
    const base = `REG/${year}/${seq}`;
    const exists = await Student.exists({ regNo: base, isDeleted: { $ne: true } });
    if (!exists) return base;

    // Preserve the sequence for auditability while making historical
    // collision repair unpredictable and collision resistant.
    for (let i = 0; i < 5; i += 1) {
      const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
      const candidate = `${base}-${suffix}`;
      const collision = await Student.exists({ regNo: candidate, isDeleted: { $ne: true } });
      if (!collision) return candidate;
    }
  }
  throw new Error('Unable to allocate a unique registration number.');
}

module.exports = { nextRegNo };
