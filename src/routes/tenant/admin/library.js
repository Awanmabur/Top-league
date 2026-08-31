const express = require("express");
const router = express.Router();
const libraryController = require("../../../controllers/tenant/admin/libraryController");

router.get("/", libraryController.index);
router.get("/export.csv", libraryController.exportCsv);
router.get("/report.csv", libraryController.reportCsv);
router.post("/import", libraryController.importCsv);
router.post("/bulk", libraryController.bulkAction);
router.post("/settings", libraryController.saveSettings);
router.post("/books", libraryController.createBook);
router.post("/books/:id/update", libraryController.updateBook);
router.post("/books/:id/add-copy", libraryController.addCopy);
router.post("/books/:id/mark-damaged", libraryController.markDamaged);
router.post("/borrow", libraryController.borrowBook);
router.post("/books/:bookId/borrows/:borrowId/return", libraryController.returnBook);
router.post("/books/:id/reservations", libraryController.createReservation);
router.post("/books/:bookId/reservations/:reservationId/status", libraryController.changeReservationStatus);
router.post("/fines", libraryController.createFine);
router.post("/books/:id/fines", libraryController.createFine);
router.post("/fines/:fineId/status", libraryController.changeFineStatus);
router.post("/books/:bookId/fines/:fineId/status", libraryController.changeFineStatus);
router.post("/holds", libraryController.createHold);
router.post("/books/:id/holds", libraryController.createHold);
router.post("/holds/:holdId/update", libraryController.updateHold);
router.post("/holds/:holdId/status", libraryController.changeHoldStatus);
router.post("/books/:bookId/holds/:holdId/status", libraryController.changeHoldStatus);

module.exports = router;
