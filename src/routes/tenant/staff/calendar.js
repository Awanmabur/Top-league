const router=require("express").Router();const c=require("../../../controllers/tenant/staff/calendarController");router.get("/calendar",c.index);module.exports=router;
