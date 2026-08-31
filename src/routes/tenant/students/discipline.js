const router=require("express").Router();const c=require("../../../controllers/tenant/students/disciplineController");router.get("/discipline",c.index);module.exports=router;
