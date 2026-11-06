'use strict';
const router=require('express').Router;
const queues=require('../services/work-queues');
const {WorkflowError}=require('../services/activity-workflow');
module.exports=db=>{
 const r=router();
 r.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const handle=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(e){if(e instanceof WorkflowError)return res.status(e.status).json({error:e.message});next(e);}};
 r.get('/v8/work-queues',handle(req=>{
  const pages={};
  for(const lane of queues.LANES){
   const raw=req.query[lane+'_page'];
   if(raw!==undefined){
    if(req.crmUser.role!=='admin')throw new WorkflowError(403,'Lehitsemine on administraatori ülevaates.');
    if(typeof raw!=='string'||!/^\d{1,6}$/.test(raw))throw new WorkflowError(400,'Vigane lehekülg.');
    pages[lane]=Number(raw);
   }
  }
  return queues.read(db,req.crmUser,{pages});
 }));
 r.post('/v8/work-queues/select',handle(req=>queues.select(db,req.crmUser,req.body||{})));
 return r;
};
