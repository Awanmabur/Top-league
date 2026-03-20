const mongoose = require("mongoose");

const actorUserId = (req) =>
  req.user?.userId || req.user?._id || req.session?.tenantUser?.id || null;

const str = (v) => String(v ?? "").trim();
const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));

const asNum = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const asDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function getStaffName(st) {
  if (!st) return "—";
  return (
    st.fullName ||
    [st.firstName, st.middleName, st.lastName].filter(Boolean).join(" ") ||
    st.name ||
    st.staffId ||
    "—"
  );
}

function getDepartmentName(dep) {
  if (!dep) return "—";
  return dep.name || dep.title || dep.code || "—";
}

function serializePayrollRun(doc, itemStats = null) {
  const grossAmount =
    itemStats?.grossAmount ??
    Number(doc.grossAmount || 0);

  const deductionsAmount =
    itemStats?.deductionsAmount ??
    Number(doc.deductionsAmount || 0);

  const netAmount =
    itemStats?.netAmount ??
    Number(doc.netAmount || 0);

  const staffCount =
    itemStats?.staffCount ??
    Number(doc.staffCount || 0);

  return {
    id: String(doc._id),
    title: doc.title || "",
    periodLabel: doc.periodLabel || "",
    month: doc.month || "",
    year: Number(doc.year || 0),
    departmentId: doc.departmentId?._id
      ? String(doc.departmentId._id)
      : String(doc.departmentId || ""),
    departmentName: getDepartmentName(doc.departmentId),
    payDate: doc.payDate ? new Date(doc.payDate).toISOString().slice(0, 10) : "",
    status: doc.status || "Draft",
    staffCount,
    grossAmount,
    deductionsAmount,
    netAmount,
    notes: doc.notes || "",
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : "",
  };
}

function serializePayrollItem(doc) {
  return {
    id: String(doc._id),
    payrollRunId: doc.payrollRunId?._id
      ? String(doc.payrollRunId._id)
      : String(doc.payrollRunId || ""),
    staffId: doc.staffId?._id
      ? String(doc.staffId._id)
      : String(doc.staffId || ""),
    staffName: getStaffName(doc.staffId),
    departmentName: getDepartmentName(doc.departmentId),
    basicSalary: Number(doc.basicSalary || 0),
    allowances: Number(doc.allowances || 0),
    bonuses: Number(doc.bonuses || 0),
    deductions: Number(doc.deductions || 0),
    grossPay: Number(doc.grossPay || 0),
    netPay: Number(doc.netPay || 0),
    status: doc.status || "Pending",
    notes: doc.notes || "",
  };
}

function computeRunStats(items = []) {
  return {
    staffCount: items.length,
    grossAmount: items.reduce((sum, x) => sum + Number(x.grossPay || 0), 0),
    deductionsAmount: items.reduce((sum, x) => sum + Number(x.deductions || 0), 0),
    netAmount: items.reduce((sum, x) => sum + Number(x.netPay || 0), 0),
  };
}

function computeKpis(runs = []) {
  return {
    total: runs.length,
    draft: runs.filter((x) => x.status === "Draft").length,
    processed: runs.filter((x) => x.status === "Processed").length,
    approved: runs.filter((x) => x.status === "Approved").length,
    closed: runs.filter((x) => x.status === "Closed").length,
    netTotal: runs.reduce((sum, x) => sum + Number(x.netAmount || 0), 0),
  };
}

function buildFilters(query = {}) {
  const q = str(query.q);
  const status = str(query.status || "all");
  const department = str(query.department || "all");
  const year = str(query.year || "all");
  const view = str(query.view || "list") || "list";

  const clean = { q, status, department, year, view };
  return { clean };
}

module.exports = {
  index: async (req, res) => {
    const { PayrollRun, PayrollItem, Department, Staff } = req.models;

    const { clean } = buildFilters(req.query);

    let [runDocs, itemDocs, departmentDocs, staffDocs] = await Promise.all([
      PayrollRun
        ? PayrollRun.find({ isDeleted: { $ne: true } })
            .populate("departmentId", "name title code")
            .sort({ year: -1, month: -1, createdAt: -1 })
            .lean()
        : [],
      PayrollItem
        ? PayrollItem.find({ isDeleted: { $ne: true } })
            .populate("staffId", "firstName middleName lastName fullName staffId")
            .populate("departmentId", "name title code")
            .populate("payrollRunId", "title")
            .sort({ createdAt: -1 })
            .lean()
        : [],
      Department
        ? Department.find({}).select("name title code").sort({ name: 1 }).lean()
        : [],
      Staff
        ? Staff.find({}).select("firstName middleName lastName fullName staffId departmentId basicSalary").sort({ createdAt: -1 }).lean()
        : [],
    ]);

    if (clean.department !== "all" && isValidId(clean.department)) {
      runDocs = runDocs.filter((x) => {
        const did = x.departmentId?._id ? String(x.departmentId._id) : String(x.departmentId || "");
        return did === clean.department;
      });
      itemDocs = itemDocs.filter((x) => {
        const did = x.departmentId?._id ? String(x.departmentId._id) : String(x.departmentId || "");
        return did === clean.department;
      });
    }

    if (clean.status !== "all") {
      runDocs = runDocs.filter((x) => String(x.status || "") === clean.status);
    }

    if (clean.year !== "all") {
      runDocs = runDocs.filter((x) => String(x.year || "") === clean.year);
    }

    if (clean.q) {
      const regex = new RegExp(clean.q, "i");
      runDocs = runDocs.filter((x) => {
        const text = [
          x.title || "",
          x.periodLabel || "",
          x.month || "",
          String(x.year || ""),
          getDepartmentName(x.departmentId),
          x.status || "",
        ].join(" ");
        return regex.test(text);
      });

      itemDocs = itemDocs.filter((x) => {
        const text = [
          getStaffName(x.staffId),
          getDepartmentName(x.departmentId),
          x.status || "",
          x.notes || "",
        ].join(" ");
        return regex.test(text);
      });
    }

    const itemsByRun = new Map();
    itemDocs.forEach((item) => {
      const runId = item.payrollRunId?._id
        ? String(item.payrollRunId._id)
        : String(item.payrollRunId || "");
      if (!runId) return;
      if (!itemsByRun.has(runId)) itemsByRun.set(runId, []);
      itemsByRun.get(runId).push(item);
    });

    const runs = runDocs.map((run) => {
      const runId = String(run._id);
      const stats = computeRunStats(itemsByRun.get(runId) || []);
      return serializePayrollRun(run, stats);
    });

    const payrollItems = itemDocs.map(serializePayrollItem);
    const kpis = computeKpis(runs);

    const yearSet = Array.from(new Set(runs.map((r) => String(r.year || "")).filter(Boolean))).sort().reverse();

    return res.render("tenant/admin/staff/payroll", {
      tenant: req.tenant,
      csrfToken: req.csrfToken?.(),
      payrollRuns: runs,
      payrollItems,
      kpis,
      departments: (departmentDocs || []).map((d) => ({
        id: String(d._id),
        name: getDepartmentName(d),
      })),
      staff: (staffDocs || []).map((s) => ({
        id: String(s._id),
        name: getStaffName(s),
        basicSalary: Number(s.basicSalary || 0),
      })),
      years: yearSet,
      query: clean,
    });
  },

  createRun: async (req, res) => {
    const { PayrollRun, PayrollItem, Staff } = req.models;

    const title = str(req.body.title);
    const month = str(req.body.month);
    const year = asNum(req.body.year, 0);
    const periodLabel = str(req.body.periodLabel || `${month} ${year}`);
    const departmentId = str(req.body.departmentId);
    const payDate = asDate(req.body.payDate);
    const notes = str(req.body.notes);

    if (!title || !month || !year) {
      req.flash?.("error", "Title, month and year are required.");
      return res.redirect("/admin/payroll");
    }

    const run = await PayrollRun.create({
      title,
      month,
      year,
      periodLabel,
      departmentId: isValidId(departmentId) ? departmentId : null,
      payDate,
      status: "Draft",
      notes,
      staffCount: 0,
      grossAmount: 0,
      deductionsAmount: 0,
      netAmount: 0,
      createdBy: actorUserId(req),
      updatedBy: actorUserId(req),
    });

    const staffFilter = {};
    if (isValidId(departmentId)) staffFilter.departmentId = departmentId;

    const staffList = Staff ? await Staff.find(staffFilter).lean() : [];

    if (staffList.length && PayrollItem) {
      const docs = staffList.map((s) => {
        const basicSalary = Number(s.basicSalary || 0);
        const allowances = 0;
        const bonuses = 0;
        const deductions = 0;
        const grossPay = basicSalary + allowances + bonuses;
        const netPay = grossPay - deductions;

        return {
          payrollRunId: run._id,
          staffId: s._id,
          departmentId: s.departmentId || null,
          basicSalary,
          allowances,
          bonuses,
          deductions,
          grossPay,
          netPay,
          status: "Pending",
          createdBy: actorUserId(req),
          updatedBy: actorUserId(req),
        };
      });

      await PayrollItem.insertMany(docs);

      const stats = computeRunStats(docs);
      await PayrollRun.updateOne(
        { _id: run._id },
        {
          $set: {
            staffCount: stats.staffCount,
            grossAmount: stats.grossAmount,
            deductionsAmount: stats.deductionsAmount,
            netAmount: stats.netAmount,
          },
        }
      );
    }

    req.flash?.("success", "Payroll run created successfully.");
    return res.redirect("/admin/payroll");
  },

  updateRun: async (req, res) => {
    const { PayrollRun } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid payroll run ID.");
      return res.redirect("/admin/payroll");
    }

    const run = await PayrollRun.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    });

    if (!run) {
      req.flash?.("error", "Payroll run not found.");
      return res.redirect("/admin/payroll");
    }

    run.title = str(req.body.title);
    run.month = str(req.body.month);
    run.year = asNum(req.body.year, run.year || 0);
    run.periodLabel = str(req.body.periodLabel || `${run.month} ${run.year}`);
    run.departmentId = isValidId(req.body.departmentId) ? req.body.departmentId : null;
    run.payDate = asDate(req.body.payDate);
    run.notes = str(req.body.notes);
    run.updatedBy = actorUserId(req);

    await run.save();

    req.flash?.("success", "Payroll run updated successfully.");
    return res.redirect("/admin/payroll");
  },

  processRun: async (req, res) => {
    const { PayrollRun } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid payroll run ID.");
      return res.redirect("/admin/payroll");
    }

    await PayrollRun.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Processed", updatedBy: actorUserId(req) } }
    );

    req.flash?.("success", "Payroll run processed.");
    return res.redirect("/admin/payroll");
  },

  approveRun: async (req, res) => {
    const { PayrollRun } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid payroll run ID.");
      return res.redirect("/admin/payroll");
    }

    await PayrollRun.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Approved", updatedBy: actorUserId(req) } }
    );

    req.flash?.("success", "Payroll run approved.");
    return res.redirect("/admin/payroll");
  },

  closeRun: async (req, res) => {
    const { PayrollRun } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid payroll run ID.");
      return res.redirect("/admin/payroll");
    }

    await PayrollRun.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { status: "Closed", updatedBy: actorUserId(req) } }
    );

    req.flash?.("success", "Payroll run closed.");
    return res.redirect("/admin/payroll");
  },

  deleteRun: async (req, res) => {
    const { PayrollRun, PayrollItem } = req.models;

    if (!isValidId(req.params.id)) {
      req.flash?.("error", "Invalid payroll run ID.");
      return res.redirect("/admin/payroll");
    }

    await PayrollRun.updateOne(
      { _id: req.params.id, isDeleted: { $ne: true } },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedBy: actorUserId(req),
        },
      }
    );

    if (PayrollItem) {
      await PayrollItem.updateMany(
        { payrollRunId: req.params.id, isDeleted: { $ne: true } },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            updatedBy: actorUserId(req),
          },
        }
      );
    }

    req.flash?.("success", "Payroll run deleted.");
    return res.redirect("/admin/payroll");
  },

  bulkAction: async (req, res) => {
    const { PayrollRun } = req.models;

    const ids = str(req.body.ids)
      .split(",")
      .map((x) => x.trim())
      .filter((x) => isValidId(x));

    if (!ids.length) {
      req.flash?.("error", "No payroll runs selected.");
      return res.redirect("/admin/payroll");
    }

    const action = str(req.body.action);
    const patch = { updatedBy: actorUserId(req) };

    if (action === "process") patch.status = "Processed";
    if (action === "approve") patch.status = "Approved";
    if (action === "close") patch.status = "Closed";
    if (action === "draft") patch.status = "Draft";
    if (action === "delete") {
      patch.isDeleted = true;
      patch.deletedAt = new Date();
    }

    await PayrollRun.updateMany(
      { _id: { $in: ids }, isDeleted: { $ne: true } },
      { $set: patch }
    );

    req.flash?.("success", "Bulk action applied.");
    return res.redirect("/admin/payroll");
  },
};