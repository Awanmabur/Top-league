const router=require("express").Router();const c=require("../../../controllers/tenant/parents/disciplineController");router.get("/discipline",c.index);module.exports=router;
