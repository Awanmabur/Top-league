const { sendMail } = require("../../../utils/mailer");

function s(v){ return (v===null||v===undefined) ? "" : String(v).trim(); }
function objId(v){ return (v && String(v).match(/^[a-f0-9]{24}$/i)) ? String(v) : null; }

function escRegex(v) {
  return String(v || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeName(a){
  if(!a) return "";
  if(a.fullName) return String(a.fullName);
  return [a.firstName, a.middleName, a.lastName].filter(Boolean).join(" ").trim();
}

function fmtDate(d){
  if(!d) return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return x.toLocaleDateString();
}

function renderTemplate(html, vars){
  let out = String(html || "");
  Object.keys(vars || {}).forEach((k)=>{
    const val = (vars[k]===null||vars[k]===undefined) ? "" : String(vars[k]);
    out = out.split("{{"+k+"}}").join(val);
  });
  return out;
}

async function ensureDefaultTemplate(req) {
  const { OfferLetterTemplate } = req.models;

  const existing = await OfferLetterTemplate.findOne({
    isDeleted: { $ne: true },
    isActive: true
  }).lean();

  if (existing) return existing;

  const tenantName = (req.tenant && req.tenant.name) ? req.tenant.name : "Classic Academy";

  const bodyHtml = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#0f172a;line-height:1.5">
    <div style="max-width:820px;margin:0 auto;border:1px solid rgba(13,64,96,.12);border-radius:16px;padding:18px;background:#fff">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <div style="font-weight:1000;font-size:18px">${tenantName}</div>
          <div style="color:#6b7280;font-size:12px">Admissions Office</div>
        </div>
        <div style="text-align:right;color:#6b7280;font-size:12px">
          <div><b>Offer Letter No:</b> {{letterNo}}</div>
          <div><b>Date:</b> {{date}}</div>
        </div>
      </div>

      <hr style="border:none;border-top:1px solid rgba(13,64,96,.12);margin:14px 0"/>

      <div style="font-weight:900;margin:0 0 6px">To: {{fullName}}</div>
      <div style="color:#6b7280;font-size:12px;margin-bottom:10px">Email: {{email}} • Phone: {{phone}}</div>

      <div style="font-weight:1000;font-size:16px;margin:10px 0">Subject: {{subjectLine}}</div>

      <p>Congratulations {{fullName}}!</p>

      <p>We are pleased to offer you admission to <b>{{section}}</b> in the <b>{{intake}}</b> intake.</p>

      <div style="background:#f8fbff;border:1px solid rgba(13,64,96,.12);border-radius:14px;padding:12px;margin:10px 0">
        <div><b>Section:</b> {{section}}</div>
        <div><b>Intake:</b> {{intake}}</div>
        <div><b>Study Mode:</b> {{studyMode}}</div>
        <div><b>Academic Year:</b> {{academicYear}}</div>
      </div>

      <p>To secure your place, please complete the admission requirements and report within the dates provided by the Admissions Office.</p>

      <p style="margin-top:16px">
        Sincerely,<br/>
        <b>Admissions Office</b><br/>
        ${tenantName}
      </p>

      <div style="color:#6b7280;font-size:11px;margin-top:16px">
        This letter is system-generated and valid without signature where permitted.
      </div>
    </div>
  </div>
  `;

  const created = await OfferLetterTemplate.create({
    name: "Default Offer Letter",
    isActive: true,
    subject: "Offer of Admission — {{section}} ({{intake}})",
    bodyHtml,
    createdBy: req.user ? req.user._id : null,
    updatedBy: req.user ? req.user._id : null,
  });

  return created.toObject();
}

async function nextLetterNo(req) {
  const { OfferLetter } = req.models;
  const yyyy = new Date().getFullYear();
  const prefix = `OFF-${yyyy}-`;

  const last = await OfferLetter.findOne({
    isDeleted: { $ne: true },
    letterNo: new RegExp("^" + prefix)
  })
    .sort({ createdAt: -1, _id: -1 })
    .lean();

  let n = 1;
  if (last && last.letterNo) {
    const tail = String(last.letterNo).split("-").pop();
    const parsed = parseInt(tail, 10);
    if (Number.isFinite(parsed)) n = parsed + 1;
  }

  return `${prefix}${String(n).padStart(4, "0")}`;
}

module.exports = {
  async index(req, res) {
    try {
      const { Applicant, OfferLetter, Section, Intake } = req.models || {};
      if (!Applicant || !OfferLetter || !Section || !Intake) {
        throw new Error("Admissions models are not fully loaded for offer letters.");
      }

      const q = s(req.query.q);
      const intakeId = s(req.query.intakeId);
      const programId = s(req.query.sectionId || req.query.programId);
      const status = s(req.query.status);

      const intakes = await Intake.find({ isDeleted: { $ne: true } })
        .sort({ isActive: -1, createdAt: -1 })
        .lean();

      const programs = await Section.find({ status: { $ne: "archived" } })
        .sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 })
        .lean();

      const template = await ensureDefaultTemplate(req);

      const acceptedFilter = {
        isDeleted: { $ne: true },
        status: { $in: ["accepted", "converted"] },
      };

      if (q) {
        const rx = new RegExp(escRegex(q), "i");
        acceptedFilter.$or = [
          { applicationId: rx },
          { fullName: rx },
          { firstName: rx },
          { lastName: rx },
          { email: rx },
          { phone: rx },
        ];
      }

      if (programId && objId(programId)) acceptedFilter.$and = [{ $or: [{ section1: objId(programId) }, { program1: objId(programId) }] }];
      if (intakeId && objId(intakeId)) acceptedFilter.intakeId = objId(intakeId);

      const accepted = await Applicant.find(acceptedFilter)
        .sort({ createdAt: -1, _id: -1 })
        .populate("section1")
        .populate("program1")
        .lean();

      const lettersFilter = { isDeleted: { $ne: true } };
      if (status) lettersFilter.status = status;
      if (programId && objId(programId)) lettersFilter.program = objId(programId);
      if (intakeId && objId(intakeId)) lettersFilter.intakeId = objId(intakeId);

      const letters = await OfferLetter.find(lettersFilter)
        .sort({ createdAt: -1, _id: -1 })
        .populate("applicant")
        .populate("program")
        .populate("intakeId")
        .lean();

      const latestByApplicant = {};
      letters.forEach((l) => {
        const aid = l && l.applicant && l.applicant._id ? String(l.applicant._id) : "";
        if (!aid) return;
        if (!latestByApplicant[aid]) latestByApplicant[aid] = l;
      });

      const kpis = {
        accepted: accepted.length,
        letters: letters.length,
        draft: letters.filter((x) => String(x.status || "draft") === "draft").length,
        sent: letters.filter((x) => String(x.status || "") === "sent").length,
      };

      return res.render("tenant/offerLetters/index", {
        tenant: req.tenant,
        csrfToken: typeof req.csrfToken === "function" ? req.csrfToken() : "",
        template,
        programs,
        intakes,
        accepted,
        letters,
        latestByApplicant,
        kpis,
        query: { q, intakeId, programId, status },
        messages: {
          success: req.flash ? req.flash("success") : [],
          error: req.flash ? req.flash("error") : [],
        },
      });
    } catch (err) {
      console.error("[OL:index]", err);
      return res.status(500).send("Failed to load offer letters.");
    }
  },

  async updateTemplate(req, res) {
    try {
      const { OfferLetterTemplate } = req.models;
      const active = await ensureDefaultTemplate(req);

      const t = await OfferLetterTemplate.findById(active._id);
      if (!t) return res.status(404).send("Template not found.");

      const subject = s(req.body.subject);
      const bodyHtml = String(req.body.bodyHtml || "");

      if (!subject || subject.length < 3) {
        req.flash?.("error", "Subject is required.");
        return res.redirect("/admin/admissions/offer-letters");
      }

      if (!bodyHtml || bodyHtml.length < 20) {
        req.flash?.("error", "Body HTML is required.");
        return res.redirect("/admin/admissions/offer-letters");
      }

      t.subject = subject;
      t.bodyHtml = bodyHtml;
      t.updatedBy = req.user ? req.user._id : null;
      await t.save();

      req.flash?.("success", "Offer letter template updated.");
      return res.redirect("/admin/admissions/offer-letters");
    } catch (err) {
      console.error("[OL:updateTemplate]", err);
      req.flash?.("error", "Failed to update template.");
      return res.redirect("/admin/admissions/offer-letters");
    }
  },

  async generate(req, res) {
    try {
      const { Applicant, OfferLetter, Intake } = req.models;

      const applicantId = objId(req.body.applicantId);
      if (!applicantId) {
        req.flash?.("error", "Invalid applicant.");
        return res.redirect("/admin/admissions/offer-letters");
      }

      const applicant = await Applicant.findOne({
        _id: applicantId,
        isDeleted: { $ne: true }
      }).populate("section1").populate("program1").lean();

      if (!applicant) {
        req.flash?.("error", "Applicant not found.");
        return res.redirect("/admin/admissions/offer-letters");
      }

      if (!["accepted", "converted"].includes(String(applicant.status))) {
        req.flash?.("error", "Applicant must be accepted first.");
        return res.redirect("/admin/admissions/offer-letters");
      }

      const template = await ensureDefaultTemplate(req);
      const letterNo = await nextLetterNo(req);

      let intakeLabel = s(applicant.intakeCode || applicant.intakeName || applicant.intake);
      if (!intakeLabel && applicant.intakeId) {
        const it = await Intake.findById(applicant.intakeId).lean();
        if (it) intakeLabel = s(it.name || it.term || it.code);
      }

      const section = applicant.section1 || applicant.program1 || null;
      const programLabel = (section && (section.name || section.className || section.code))
        ? (section.name || section.className || section.code)
        : "Section";

      const subjectLine = renderTemplate(template.subject, {
        program: programLabel,
        section: programLabel,
        intake: intakeLabel
      });

      const html = renderTemplate(template.bodyHtml, {
        letterNo,
        date: fmtDate(new Date()),
        fullName: safeName(applicant),
        email: s(applicant.email),
        phone: s(applicant.phone),
        program: programLabel,
        section: programLabel,
        intake: intakeLabel,
        studyMode: s(applicant.studyMode),
        academicYear: s(applicant.academicYear),
        subjectLine,
      });

      await OfferLetter.create({
        letterNo,
        applicant: applicant._id,
        program: section ? section._id : null,
        intakeId: applicant.intakeId || null,
        template: template._id,
        subject: subjectLine,
        bodyHtml: html,
        status: "draft",
        issuedAt: new Date(),
        issuedBy: req.user ? req.user._id : null,
        sentToEmail: s(applicant.email).toLowerCase(),
        notes: "",
      });

      req.flash?.("success", "Offer letter draft generated.");
      return res.redirect("/admin/admissions/offer-letters");
    } catch (err) {
      console.error("[OL:generate]", err);
      req.flash?.("error", String(err && err.code) === "11000" ? "Letter number conflict. Retry." : "Failed to generate offer letter.");
      return res.redirect("/admin/admissions/offer-letters");
    }
  },

  async send(req, res) {
    try {
      const { OfferLetter } = req.models;
      const id = req.params.id;

      const letter = await OfferLetter.findOne({
        _id: id,
        isDeleted: { $ne: true }
      }).populate("applicant");

      if (!letter) {
        req.flash?.("error", "Offer letter not found.");
        return res.redirect("/admin/admissions/offer-letters");
      }

      if (letter.status === "void") {
        req.flash?.("error", "This letter is void.");
        return res.redirect("/admin/admissions/offer-letters");
      }

      const to = s(req.body.to || (letter.applicant && letter.applicant.email) || letter.sentToEmail).toLowerCase();
      if (!to) {
        req.flash?.("error", "Recipient email is required.");
        return res.redirect("/admin/admissions/offer-letters");
      }

      await sendMail({ to, subject: letter.subject, html: letter.bodyHtml });

      letter.status = "sent";
      letter.sentAt = new Date();
      letter.sentBy = req.user ? req.user._id : null;
      letter.sentToEmail = to;
      await letter.save();

      req.flash?.("success", "Offer letter sent.");
      return res.redirect("/admin/admissions/offer-letters");
    } catch (err) {
      console.error("[OL:send]", err);
      req.flash?.("error", String(err && err.message ? err.message : "Failed to send offer letter."));
      return res.redirect("/admin/admissions/offer-letters");
    }
  },

  async voidLetter(req, res) {
    try {
      const { OfferLetter } = req.models;
      const id = req.params.id;

      const letter = await OfferLetter.findOne({
        _id: id,
        isDeleted: { $ne: true }
      });

      if (!letter) {
        req.flash?.("error", "Offer letter not found.");
        return res.redirect("/admin/admissions/offer-letters");
      }

      letter.status = "void";
      await letter.save();

      req.flash?.("success", "Offer letter voided.");
      return res.redirect("/admin/admissions/offer-letters");
    } catch (err) {
      console.error("[OL:void]", err);
      req.flash?.("error", "Failed to void offer letter.");
      return res.redirect("/admin/admissions/offer-letters");
    }
  },
};
