const express = require("express");
const router = express.Router();
const supportTicketsController = require("../../controllers/platform/supportTicketsController");
const { platformRequire } = require("../../middleware/platform/guards");

router.get("/super-admin/support-tickets", platformRequire("support.view"), supportTicketsController.listSupportTickets);

router.get("/super-admin/support-tickets/create", platformRequire("support.manage"), supportTicketsController.createSupportTicketForm);
router.post("/super-admin/support-tickets/create", platformRequire("support.manage"), supportTicketsController.createSupportTicket);

router.get("/super-admin/support-tickets/:id", platformRequire("support.view"), supportTicketsController.showSupportTicket);
router.post("/super-admin/support-tickets/:id/assign", platformRequire("support.manage"), supportTicketsController.assignSupportTicket);
router.post("/super-admin/support-tickets/:id/status", platformRequire("support.manage"), supportTicketsController.updateSupportTicketStatus);
router.post("/super-admin/support-tickets/:id/reply", platformRequire("support.manage"), supportTicketsController.replySupportTicket);

module.exports = router;
