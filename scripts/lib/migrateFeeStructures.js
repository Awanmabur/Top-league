const {
  structureCodeCandidate,
} = require("../../src/services/tenant/feeStructureService");
const {
  createInvoiceRecord,
  createPaymentRecord,
  computeInvoiceTotals,
  normalizeCurrency,
} = require("../../src/services/tenant/financeService");

function clean(v, max = 1000) { return String(v ?? "").trim().slice(0, max); }

async function allocateStructureCode(FeeStructure, used) {
  for (let i = 0; i < 20; i += 1) {
    const code = structureCodeCandidate();
    if (used.has(code)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (!(await FeeStructure.exists({ structureCode: code }))) { used.add(code); return code; }
  }
  throw new Error("Could not repair fee structure code.");
}

async function repairStructureCodes(FeeStructure) {
  if (!FeeStructure) return 0;
  const rows = await FeeStructure.find({}).sort({ createdAt: 1, _id: 1 }).lean();
  const counts = new Map();
  rows.forEach((row) => { const code = clean(row.structureCode, 48).toUpperCase(); if (code) counts.set(code, (counts.get(code) || 0) + 1); });
  const used = new Set(counts.keys());
  const kept = new Set();
  let repaired = 0;
  for (const row of rows) {
    const current = clean(row.structureCode, 48).toUpperCase();
    const keep = current && ((counts.get(current) || 0) === 1 || !kept.has(current));
    if (keep) { kept.add(current); continue; }
    // eslint-disable-next-line no-await-in-loop
    const code = await allocateStructureCode(FeeStructure, used);
    // eslint-disable-next-line no-await-in-loop
    await FeeStructure.updateOne({ _id: row._id }, { $set: { structureCode: code } });
    repaired += 1;
  }
  return repaired;
}

function legacyInvoiceItems(fee) {
  return (Array.isArray(fee.items) ? fee.items : []).map((item) => ({
    title: clean(item.title, 160) || "Legacy fee item",
    category: clean(item.category, 40),
    qty: 1,
    unitAmount: Math.max(0, Number(item.amount || 0)),
    note: clean(item.note, 500),
  }));
}

async function migrateLegacyFees(models) {
  const { Fees: Fee, Invoice, Payment } = models;
  if (!Fee || !Invoice || !Payment) return { scanned: 0, invoicesCreated: 0, paymentClaimsCreated: 0, skipped: 0 };
  const fees = await Fee.find({}).sort({ createdAt: 1, _id: 1 }).lean();
  let invoicesCreated = 0;
  let paymentClaimsCreated = 0;
  let skipped = 0;

  for (const fee of fees) {
    const reference = `LEGACY-FEE:${fee._id}`;
    // eslint-disable-next-line no-await-in-loop
    let invoice = await Invoice.findOne({ reference }).lean();
    if (!invoice) {
      const totals = computeInvoiceTotals(legacyInvoiceItems(fee), fee.discount, 0);
      if (!fee.student || !totals.items.length || !(totals.totalAmount > 0)) { skipped += 1; continue; }
      const status = fee.status === "draft" ? "Draft" : fee.status === "void" ? "Cancelled" : "Unpaid";
      // eslint-disable-next-line no-await-in-loop
      const created = await createInvoiceRecord(Invoice, {
        reference,
        studentId: fee.student,
        programId: null,
        feeStructureId: null,
        term: fee.term ? `Term ${fee.term}` : "",
        academicYear: clean(fee.academicYear, 80),
        ...totals,
        paidAmount: 0,
        balance: totals.totalAmount,
        currency: normalizeCurrency("UGX"),
        status,
        issueDate: fee.issuedAt || fee.createdAt || new Date(),
        dueDate: fee.dueDate || null,
        notes: [clean(fee.notes, 1200), `Migrated from legacy Fee ${fee._id}.`].filter(Boolean).join("\n"),
        createdBy: fee.createdBy || null,
        updatedBy: fee.updatedBy || null,
        cancelledAt: status === "Cancelled" ? (fee.updatedAt || fee.createdAt || new Date()) : null,
        cancelReason: status === "Cancelled" ? "Migrated legacy void fee." : "",
      });
      invoice = created.toObject ? created.toObject() : created;
      invoicesCreated += 1;
    }

    const legacyPaid = Math.max(0, Number(fee.amountPaid || 0));
    if (legacyPaid > 0) {
      const claimRef = `LEGACY-FEE-PAID-CLAIM:${fee._id}`;
      // eslint-disable-next-line no-await-in-loop
      const exists = await Payment.exists({ reference: claimRef });
      if (!exists) {
        // A legacy amountPaid field is not sufficient evidence of settled money. Keep the
        // claim Pending until an administrator reconciles it against a real source record.
        // eslint-disable-next-line no-await-in-loop
        await createPaymentRecord(Payment, {
          invoiceId: invoice._id,
          studentId: fee.student,
          programId: invoice.programId || null,
          academicYear: clean(fee.academicYear, 80),
          term: invoice.term || "",
          amount: legacyPaid,
          appliedAmount: 0,
          currency: invoice.currency || "UGX",
          method: "Other",
          reference: claimRef,
          status: "Pending",
          paymentDate: fee.issuedAt || fee.updatedAt || fee.createdAt || new Date(),
          notes: `Legacy Fee.amountPaid claim (${legacyPaid}) imported for reconciliation; not counted as received until explicitly completed.`,
          createdBy: fee.createdBy || null,
          updatedBy: fee.updatedBy || null,
        });
        paymentClaimsCreated += 1;
      }
    }
  }
  return { scanned: fees.length, invoicesCreated, paymentClaimsCreated, skipped };
}

async function migrateFeeStructures(models = {}) {
  const repairedStructureCodes = await repairStructureCodes(models.FeeStructure);
  const legacy = await migrateLegacyFees(models);
  return { repairedStructureCodes, ...legacy };
}

module.exports = { migrateFeeStructures, repairStructureCodes, migrateLegacyFees };
