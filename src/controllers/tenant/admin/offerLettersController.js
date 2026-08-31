const { sendMail } = require('../../../utils/mailer');
const { allocateOfferLetterNo, escapeHtml } = require('../../../services/tenant/admissionsService');
const {
  offerContentHash,
  offerCurrentKey,
  offerSendState,
  objectIdString,
  positiveRevision,
  sendClaimToken,
  str,
} = require('../../../services/tenant/admissionsOperationsService');

function escRegex(value) { return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function safeName(applicant) {
  if (!applicant) return '';
  return str(applicant.fullName || [applicant.firstName, applicant.middleName, applicant.lastName].filter(Boolean).join(' '), 160);
}
function fmtDate(date) {
  const parsed = date ? new Date(date) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleDateString() : '';
}
function renderTemplate(template, vars, { escapeValues = false } = {}) {
  let out = String(template || '');
  for (const [key, value] of Object.entries(vars || {})) {
    const raw = value == null ? '' : String(value);
    const rendered = escapeValues ? escapeHtml(raw) : raw;
    out = out.split(`{{${key}}}`).join(rendered);
  }
  return out;
}
function hasUnsafeTemplateHtml(value) {
  const html = String(value || '');
  return /<(?:script|iframe|object|embed|form|base|meta|link)\b/i.test(html)
    || /\bon[a-z]+\s*=/i.test(html)
    || /\b(?:formaction|srcdoc)\s*=/i.test(html)
    || /javascript\s*:/i.test(html)
    || /expression\s*\(/i.test(html);
}
function redirectTarget(req) {
  const target = str(req.body?.returnTo, 500);
  return target.startsWith('/admin/admissions/') ? target : '/admin/admissions/offer-letters';
}

async function ensureDefaultTemplate(req) {
  const { OfferLetterTemplate } = req.models || {};
  if (!OfferLetterTemplate) throw new Error('Offer letter template model is unavailable.');
  const existing = await OfferLetterTemplate.findOne({ isDeleted: { $ne: true }, singletonKey: 'default' }).lean()
    || await OfferLetterTemplate.findOne({ isDeleted: { $ne: true }, isActive: true }).lean();
  if (existing) {
    if (existing.singletonKey !== 'default') {
      await OfferLetterTemplate.updateOne({ _id: existing._id, singletonKey: { $ne: 'default' } }, { $set: { singletonKey: 'default', isActive: true }, $inc: { revision: 1 } }).catch(() => {});
      return OfferLetterTemplate.findById(existing._id).lean();
    }
    return existing;
  }

  const tenantName = req.tenant?.name || 'Classic Academy';
  const safeTenantName = escapeHtml(tenantName);
  const bodyHtml = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;color:#0f172a;line-height:1.5">
    <div style="max-width:820px;margin:0 auto;border:1px solid rgba(13,64,96,.12);border-radius:16px;padding:18px;background:#fff">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div><div style="font-weight:1000;font-size:18px">${safeTenantName}</div><div style="color:#6b7280;font-size:12px">Admissions Office</div></div>
        <div style="text-align:right;color:#6b7280;font-size:12px"><div><b>Offer Letter No:</b> {{letterNo}}</div><div><b>Date:</b> {{date}}</div></div>
      </div>
      <hr style="border:none;border-top:1px solid rgba(13,64,96,.12);margin:14px 0"/>
      <div style="font-weight:900;margin:0 0 6px">To: {{fullName}}</div>
      <div style="color:#6b7280;font-size:12px;margin-bottom:10px">Email: {{email}} • Phone: {{phone}}</div>
      <div style="font-weight:1000;font-size:16px;margin:10px 0">Subject: {{subjectLine}}</div>
      <p>Congratulations {{fullName}}!</p>
      <p>We are pleased to offer you admission to <b>{{section}}</b> in the <b>{{intake}}</b> intake.</p>
      <div style="background:#f8fbff;border:1px solid rgba(13,64,96,.12);border-radius:14px;padding:12px;margin:10px 0">
        <div><b>Section:</b> {{section}}</div><div><b>Intake:</b> {{intake}}</div><div><b>Study Mode:</b> {{studyMode}}</div><div><b>Academic Year:</b> {{academicYear}}</div>
      </div>
      <p>To secure your place, please complete the admission requirements and report within the dates provided by the Admissions Office.</p>
      <p style="margin-top:16px">Sincerely,<br/><b>Admissions Office</b><br/>${safeTenantName}</p>
      <div style="color:#6b7280;font-size:11px;margin-top:16px">This letter is system-generated and valid without signature where permitted.</div>
    </div>
  </div>`;
  try {
    const created = await OfferLetterTemplate.create({
      name: 'Default Offer Letter', singletonKey: 'default', isActive: true, revision: 1,
      subject: 'Offer of Admission — {{section}} ({{intake}})', bodyHtml,
      createdBy: req.user?._id || null, updatedBy: req.user?._id || null,
    });
    return created.toObject();
  } catch (err) {
    if (String(err?.code) === '11000') {
      const winner = await OfferLetterTemplate.findOne({ isDeleted: { $ne: true }, singletonKey: 'default' }).lean();
      if (winner) return winner;
    }
    throw err;
  }
}

module.exports = {
  async index(req, res) {
    try {
      const { Applicant, OfferLetter, Section, Intake, OfferLetterTemplate } = req.models || {};
      if (!Applicant || !OfferLetter || !Section || !Intake || !OfferLetterTemplate) throw new Error('Admissions models are not fully loaded for offer letters.');
      const q = str(req.query.q, 120);
      const intakeId = str(req.query.intakeId, 40);
      const sectionId = str(req.query.sectionId || req.query.programId, 40);
      const status = ['draft', 'sent', 'void'].includes(str(req.query.status, 20)) ? str(req.query.status, 20) : '';
      const [intakes, programs, template] = await Promise.all([
        Intake.find({ isDeleted: { $ne: true } }).sort({ isActive: -1, createdAt: -1 }).lean(),
        Section.find({ status: { $ne: 'archived' } }).sort({ levelType: 1, classLevel: 1, classStream: 1, name: 1 }).lean(),
        ensureDefaultTemplate(req),
      ]);
      const acceptedFilter = { isDeleted: { $ne: true }, status: { $in: ['accepted', 'converted'] } };
      if (q) {
        const rx = new RegExp(escRegex(q), 'i');
        acceptedFilter.$or = [{ applicationId: rx }, { fullName: rx }, { firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx }];
      }
      if (objectIdString(sectionId)) acceptedFilter.$and = [{ $or: [{ section1: objectIdString(sectionId) }, { program1: objectIdString(sectionId) }] }];
      if (objectIdString(intakeId)) acceptedFilter.intakeId = objectIdString(intakeId);
      const accepted = await Applicant.find(acceptedFilter).sort({ createdAt: -1, _id: -1 }).populate('section1').populate('program1').lean();

      const lettersFilter = { isDeleted: { $ne: true } };
      if (q) {
        const rx = new RegExp(escRegex(q), 'i');
        const matches = await Applicant.find({ isDeleted: { $ne: true }, $or: [{ applicationId: rx }, { fullName: rx }, { firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx }] }).select('_id').lean();
        lettersFilter.applicant = { $in: matches.map((row) => row._id) };
      }
      if (status) lettersFilter.status = status;
      if (objectIdString(sectionId)) lettersFilter.program = objectIdString(sectionId);
      if (objectIdString(intakeId)) lettersFilter.intakeId = objectIdString(intakeId);
      const letters = await OfferLetter.find(lettersFilter).sort({ createdAt: -1, _id: -1 }).populate('applicant').populate('program').populate('intakeId').lean();
      const latestByApplicant = {};
      for (const letter of letters) {
        const applicantId = String(letter?.applicant?._id || letter?.applicant || '');
        if (applicantId && !latestByApplicant[applicantId]) latestByApplicant[applicantId] = letter;
      }
      return res.render('tenant/offerLetters/index', {
        tenant: req.tenant,
        csrfToken: typeof req.csrfToken === 'function' ? req.csrfToken() : '',
        template, programs, intakes, accepted, letters, latestByApplicant,
        kpis: {
          accepted: accepted.length,
          letters: letters.length,
          draft: letters.filter((x) => x.status === 'draft').length,
          sent: letters.filter((x) => x.status === 'sent').length,
        },
        query: { q, intakeId, programId: sectionId, sectionId, status },
        messages: { success: req.flash ? req.flash('success') : [], error: req.flash ? req.flash('error') : [] },
      });
    } catch (err) {
      console.error('[OL:index]', err);
      return res.status(500).send('Failed to load offer letters.');
    }
  },

  async updateTemplate(req, res) {
    try {
      const { OfferLetterTemplate } = req.models || {};
      const active = await ensureDefaultTemplate(req);
      const revision = positiveRevision(req.body.revision);
      if (!revision) throw new Error('A current template revision is required. Reload and try again.');
      const subject = str(req.body.subject, 160);
      const bodyHtml = String(req.body.bodyHtml || '').slice(0, 200000);
      if (subject.length < 3) throw new Error('Subject is required.');
      if (bodyHtml.length < 20) throw new Error('Body HTML is required.');
      if (hasUnsafeTemplateHtml(bodyHtml)) throw new Error('Template HTML contains blocked active content, forms, redirects, or event handlers.');
      const result = await OfferLetterTemplate.updateOne(
        { _id: active._id, revision, isDeleted: { $ne: true }, singletonKey: 'default' },
        { $set: { subject, bodyHtml, isActive: true, updatedBy: req.user?._id || null }, $inc: { revision: 1 } },
      );
      if (result.modifiedCount !== 1) throw new Error('The template changed concurrently. Reload and try again.');
      req.flash?.('success', 'Offer letter template updated.');
    } catch (err) {
      console.error('[OL:updateTemplate]', err);
      req.flash?.('error', err.message || 'Failed to update template.');
    }
    return res.redirect('/admin/admissions/offer-letters');
  },

  async generate(req, res) {
    try {
      const { Applicant, OfferLetter, Intake } = req.models || {};
      const applicantId = objectIdString(req.body.applicantId);
      if (!applicantId) throw new Error('Invalid applicant.');
      const applicant = await Applicant.findOne({ _id: applicantId, isDeleted: { $ne: true }, status: { $in: ['accepted', 'converted'] } }).populate('section1').populate('program1').lean();
      if (!applicant) throw new Error('Applicant must still be accepted before an offer can be generated.');
      const section = applicant.section1 || applicant.program1 || null;
      if (!section?._id) throw new Error('Applicant has no valid Section assignment.');
      const currentKey = offerCurrentKey(applicant._id, applicant.intakeId);
      const existing = await OfferLetter.findOne({ currentKey, isDeleted: { $ne: true } }).select('_id letterNo status').lean();
      if (existing) throw new Error(`A current ${existing.status || 'draft'} offer (${existing.letterNo || 'existing letter'}) already exists. Void it before generating a replacement.`);
      const template = await ensureDefaultTemplate(req);
      if (hasUnsafeTemplateHtml(template.bodyHtml)) throw new Error('Active offer-letter template contains blocked active content. Edit and save the template before generating letters.');
      const letterNo = await allocateOfferLetterNo(OfferLetter);
      let intakeLabel = str(applicant.intake, 160);
      if (applicant.intakeId) {
        const intake = await Intake.findOne({ _id: applicant.intakeId, isDeleted: { $ne: true } }).lean();
        if (!intake) throw new Error('Applicant Intake no longer exists. Restore or correct the Intake before generating an offer.');
        intakeLabel = str(intake.name || intake.term || intake.code, 160);
      }
      const sectionLabel = str(section.name || section.className || section.code || 'Section', 160);
      const applicantName = safeName(applicant);
      const subject = renderTemplate(template.subject, { program: sectionLabel, section: sectionLabel, intake: intakeLabel }, { escapeValues: false });
      const bodyHtml = renderTemplate(template.bodyHtml, {
        letterNo, date: fmtDate(new Date()), fullName: applicantName,
        email: str(applicant.email, 160), phone: str(applicant.phone, 60),
        program: sectionLabel, section: sectionLabel, intake: intakeLabel,
        studyMode: str(applicant.studyMode, 60), academicYear: str(applicant.academicYear, 40), subjectLine: subject,
      }, { escapeValues: true });
      const contentHash = offerContentHash(subject, bodyHtml);
      await OfferLetter.create({
        letterNo, applicant: applicant._id, program: section._id, intakeId: applicant.intakeId || null,
        currentKey, template: template._id, templateRevision: Number(template.revision || 1), subject, bodyHtml, contentHash,
        snapshot: {
          applicantName, email: str(applicant.email, 160).toLowerCase(), phone: str(applicant.phone, 60),
          sectionLabel, intakeLabel, academicYear: str(applicant.academicYear, 40), studyMode: str(applicant.studyMode, 60),
        },
        requirementsSnapshot: Array.isArray(applicant.admissionRequirementsSnapshot) ? applicant.admissionRequirementsSnapshot : [],
        status: 'draft', deliveryStatus: 'not_sent', revision: 1,
        issuedAt: new Date(), issuedBy: req.user?._id || null,
        sentToEmail: str(applicant.email, 160).toLowerCase(), notes: str(req.body.notes, 600),
      });
      req.flash?.('success', 'Offer letter draft generated.');
    } catch (err) {
      console.error('[OL:generate]', err);
      req.flash?.('error', String(err?.code) === '11000' ? 'Another current offer was generated concurrently. Reload and review it.' : (err.message || 'Failed to generate offer letter.'));
    }
    return res.redirect(redirectTarget(req));
  },

  async send(req, res) {
    const { OfferLetter } = req.models || {};
    const id = objectIdString(req.params.id);
    const revision = positiveRevision(req.body.revision);
    const token = sendClaimToken();
    let claimedRevision = null;
    let mailAccepted = false;
    try {
      if (!id || !revision) throw new Error('A current offer-letter revision is required. Reload and try again.');
      const current = await OfferLetter.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
      if (!current) throw new Error('Offer letter not found.');
      const state = offerSendState(current);
      if (!state.allowed) throw new Error(state.reason);
      if (Number(current.revision || 1) !== revision) throw new Error('This offer letter changed concurrently. Reload and try again.');
      if (!current.contentHash || current.contentHash !== offerContentHash(current.subject, current.bodyHtml)) throw new Error('Offer letter content integrity check failed. Void and regenerate this letter.');
      if (hasUnsafeTemplateHtml(current.bodyHtml)) throw new Error('This stored letter contains blocked active HTML. Void and regenerate it from a safe template.');
      const to = str(req.body.to || current.sentToEmail || current.snapshot?.email, 160).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('A valid recipient email is required.');
      const claim = await OfferLetter.updateOne(
        { _id: id, revision, status: 'draft', isDeleted: { $ne: true }, deliveryStatus: { $in: ['not_sent', 'failed'] } },
        { $set: { deliveryStatus: 'sending', sendClaimToken: token, sendClaimAt: new Date(), lastSendError: '', sentToEmail: to }, $inc: { sendAttempts: 1, revision: 1 } },
      );
      if (claim.modifiedCount !== 1) throw new Error('This offer letter is already being sent or changed. Reload and review its delivery state.');
      claimedRevision = revision + 1;
      let info;
      try {
        info = await sendMail({ to, subject: current.subject, html: current.bodyHtml });
        mailAccepted = true;
      } catch (mailErr) {
        await OfferLetter.updateOne(
          { _id: id, revision: claimedRevision, deliveryStatus: 'sending', sendClaimToken: token },
          { $set: { deliveryStatus: 'failed', sendClaimToken: '', sendClaimAt: null, lastSendError: str(mailErr.message || 'Mail delivery failed.', 500) }, $inc: { revision: 1 } },
        );
        throw mailErr;
      }
      const finalized = await OfferLetter.updateOne(
        { _id: id, revision: claimedRevision, deliveryStatus: 'sending', sendClaimToken: token, status: 'draft' },
        { $set: {
          status: 'sent', deliveryStatus: 'sent', sentAt: new Date(), sentBy: req.user?._id || null,
          sentToEmail: to, providerMessageId: str(info?.messageId, 300), sendClaimToken: '', sendClaimAt: null, lastSendError: '',
        }, $inc: { revision: 1 } },
      );
      if (finalized.modifiedCount !== 1) throw new Error('Email delivery was accepted, but the database could not finalize the sent state. Do not resend this letter; reconcile the delivery record first.');
      req.flash?.('success', 'Offer letter sent.');
    } catch (err) {
      console.error('[OL:send]', err);
      const message = mailAccepted
        ? 'Email delivery was accepted, but final database confirmation failed. Do not resend this letter until its delivery state is reconciled.'
        : (err.message || 'Failed to send offer letter.');
      req.flash?.('error', message);
    }
    return res.redirect(redirectTarget(req));
  },

  async voidLetter(req, res) {
    try {
      const { OfferLetter } = req.models || {};
      const id = objectIdString(req.params.id);
      const revision = positiveRevision(req.body.revision);
      const reason = str(req.body.reason, 500);
      if (!id || !revision) throw new Error('A current offer-letter revision is required. Reload and try again.');
      if (reason.length < 5) throw new Error('Provide a brief reason for voiding this offer letter.');
      const current = await OfferLetter.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
      if (!current) throw new Error('Offer letter not found.');
      if (current.status === 'void') throw new Error('This offer letter is already void.');
      if (current.deliveryStatus === 'sending') throw new Error('This offer letter has a delivery in progress or awaiting reconciliation and cannot be voided yet.');
      const result = await OfferLetter.updateOne(
        { _id: id, revision, isDeleted: { $ne: true }, status: { $ne: 'void' }, deliveryStatus: { $ne: 'sending' } },
        { $set: { status: 'void', currentKey: null, voidedAt: new Date(), voidedBy: req.user?._id || null, voidReason: reason }, $inc: { revision: 1 } },
      );
      if (result.modifiedCount !== 1) throw new Error('This offer letter changed concurrently. Reload and try again.');
      req.flash?.('success', 'Offer letter voided. A replacement can now be generated if needed.');
    } catch (err) {
      console.error('[OL:void]', err);
      req.flash?.('error', err.message || 'Failed to void offer letter.');
    }
    return res.redirect(redirectTarget(req));
  },
};

module.exports._test = { hasUnsafeTemplateHtml, renderTemplate };
