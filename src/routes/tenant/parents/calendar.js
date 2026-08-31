const router=require("express").Router();const c=require("../../../controllers/tenant/parents/calendarController");router.get("/calendar",c.index);module.exports=router;
