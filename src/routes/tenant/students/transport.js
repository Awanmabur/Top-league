const express=require('express');const router=express.Router();const c=require('../../../controllers/tenant/students/transportController');router.get('/transport',c.index);module.exports=router;
