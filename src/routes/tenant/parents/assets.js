const express=require('express');const r=express.Router();const c=require('../../../controllers/tenant/parents/assetsController');r.get('/assets',c.index);module.exports=r;
