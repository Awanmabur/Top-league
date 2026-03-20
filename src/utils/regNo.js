/**
 * REG format: REG/2026/000123
 */
async function nextRegNo(models) {
  const { Counter, Student } = models;

  const year = new Date().getFullYear();
  const key = `regno:${year}`;

  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );

  const seq = String(counter.seq).padStart(6, "0");
  const regNo = `REG/${year}/${seq}`;

  // Extra safety check
  const exists = await Student.findOne({ regNo, isDeleted: { $ne: true } }).lean();
  if (!exists) return regNo;

  // extremely rare, but fallback
  return `REG/${year}/${seq}-${Math.floor(Math.random() * 1000)}`;
}

module.exports = { nextRegNo };
