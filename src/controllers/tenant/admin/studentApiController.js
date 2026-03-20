const clean = (v, max = 120) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

module.exports = {
  // GET /admin/api/students/search?q=jo
  search: async (req, res) => {
    try {
      const { Student } = req.models;

      const q = clean(req.query.q, 120);
      if (!q || q.length < 2) return res.json({ ok: true, items: [] });

      const items = await Student.find({
        isDeleted: { $ne: true },
        $or: [
          { fullName: { $regex: q, $options: "i" } },
          { regNo: { $regex: q, $options: "i" } },
          { email: { $regex: q, $options: "i" } },
          { phone: { $regex: q, $options: "i" } },
        ],
      })
        .select("_id fullName regNo email yearLevel")
        .sort({ fullName: 1 })
        .limit(12)
        .lean();

      return res.json({
        ok: true,
        items: items.map((s) => ({
          id: String(s._id),
          fullName: s.fullName || "",
          regNo: s.regNo || "",
          email: s.email || "",
          yearLevel: s.yearLevel || "",
        })),
      });
    } catch (err) {
      console.error("STUDENT SEARCH API ERROR:", err);
      return res.status(500).json({ ok: false, message: "Search failed." });
    }
  },
};
