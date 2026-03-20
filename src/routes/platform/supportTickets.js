const express = require("express");
const router = express.Router();
const supportTicketsController = require("../../controllers/platform/supportTicketsController");

router.get("/super-admin/support-tickets", supportTicketsController.listSupportTickets);

router.get("/super-admin/support-tickets/create", supportTicketsController.createSupportTicketForm);
router.post("/super-admin/support-tickets/create", supportTicketsController.createSupportTicket);

router.get("/super-admin/support-tickets/:id", supportTicketsController.showSupportTicket);
router.post("/super-admin/support-tickets/:id/assign", supportTicketsController.assignSupportTicket);
router.post("/super-admin/support-tickets/:id/status", supportTicketsController.updateSupportTicketStatus);
router.post("/super-admin/support-tickets/:id/reply", supportTicketsController.replySupportTicket);

module.exports = router;