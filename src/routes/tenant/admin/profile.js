const express = require("express");
const router = express.Router();

const profileController = require("../../../controllers/tenant/admin/profileController");
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.get("/", profileController.page);
router.post("/", profileController.update);

router.post("/upload/logo", upload.single("logo"), profileController.uploadLogo);
router.post("/upload/favicon", upload.single("favicon"), profileController.uploadFavicon);
router.post("/upload/cover", upload.single("cover"), profileController.uploadCover);
router.post("/upload/gallery", upload.any(), profileController.uploadGallery);

router.delete("/gallery/:itemId", profileController.deleteGalleryItem);

router.post("/faqs", profileController.addFaq);
router.put("/faqs/:faqId", profileController.editFaq);
router.delete("/faqs/:faqId", profileController.deleteFaq);

router.post("/reviews/:reviewId/approve", profileController.approveReview);
router.post("/reviews/:reviewId/reject", profileController.rejectReview);
router.post("/reviews/:reviewId/feature", profileController.toggleFeaturedReview);
router.delete("/reviews/:reviewId", profileController.deleteReview);

router.post("/schools/:code/reviews", profileController.submitPublicReview);

module.exports = router;