module.exports = {
  startReview: async (req, res) => {
    const { Applicant } = req.models;

    await Applicant.findByIdAndUpdate(req.params.id, {
      status: "under_review",
      reviewedBy: req.user._id,
    });

    res.redirect(`/admissions/${req.params.id}`);
  },

  acceptApplicant: async (req, res) => {
    const { Applicant, Student } = req.models;

    const applicant = await Applicant.findById(req.params.id);

    if (!applicant) return res.status(404).send("Applicant not found");

    // Create student
    await Student.create({
      firstName: applicant.firstName,
      lastName: applicant.lastName,
      email: applicant.email,
      phone: applicant.phone,
      gender: applicant.gender,
      dateOfBirth: applicant.dateOfBirth,
      programId: applicant.programId,
      status: "active",
    });

    // Update application status
    applicant.status = "accepted";
    applicant.save();

    res.redirect("/students");
  },

  rejectApplicant: async (req, res) => {
    const { Applicant } = req.models;

    await Applicant.findByIdAndUpdate(req.params.id, {
      status: "rejected",
      reviewNotes: req.body.reviewNotes,
    });

    res.redirect(`/admissions/${req.params.id}`);
  },
};
