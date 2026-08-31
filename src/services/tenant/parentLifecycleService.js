const mongoose = require('mongoose');
const { invalidateTenantUserCache } = require('../../middleware/tenant/requireTenantAuth');
const { csvCell, normalizeStudentStatus } = require('./studentLifecycleService');

const PARENT_STATUSES = Object.freeze(['active','on_hold','suspended','archived']);
const STATUS_SET = new Set(PARENT_STATUSES);
const str=(v,max=2000)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,max);
const isId=(v)=>mongoose.Types.ObjectId.isValid(String(v||''));
function normalizeParentStatus(value, fallback=null){const v=str(value,30).toLowerCase();return STATUS_SET.has(v)?v:fallback;}

async function validateChildren(models, ids=[]){
  const Student=models?.Student;
  const cleanIds=Array.from(new Set((ids||[]).map(String).filter(isId)));
  if(!cleanIds.length) return [];
  if(!Student) throw new Error('Student model is required to link children.');
  const students=await Student.find({_id:{$in:cleanIds},isDeleted:{$ne:true},status:{$ne:'archived'}}).select('_id').lean();
  if(students.length!==cleanIds.length) throw new Error('One or more selected children are unavailable.');
  return students.map((row)=>row._id);
}

async function syncParentUserAccess(req,parent,nextStatus,{deleting=false}={}){
  const User=req.models?.User; const userId=parent?.userId?._id||parent?.userId;
  if(!User||!userId||!isId(userId)) return;
  const user=await User.findOne({_id:userId,deletedAt:null}).select('_id status parentAccessSuspended parentAccessPreviousStatus').lean();
  if(!user) return;
  if(deleting||['suspended','archived'].includes(nextStatus)){
    if(user.status==='suspended'&&user.parentAccessSuspended!==true) return;
    const set={parentAccessSuspended:true}; const update={$set:set};
    if(deleting) set.childrenStudentIds=[];
    if(user.status!=='suspended'){
      set.parentAccessPreviousStatus=['invited','active'].includes(user.status)?user.status:'active';
      set.status='suspended';
      update.$inc={tokenVersion:1};
    } else if(deleting) {
      update.$inc={tokenVersion:1};
    }
    await User.updateOne({_id:userId,deletedAt:null},update); invalidateTenantUserCache(req.tenant?.code,String(userId)); return;
  }
  if(['active','on_hold'].includes(nextStatus)&&user.parentAccessSuspended===true){
    const restored=['invited','active'].includes(user.parentAccessPreviousStatus)?user.parentAccessPreviousStatus:'active';
    await User.updateOne(
      {_id:userId,deletedAt:null,parentAccessSuspended:true},
      {$set:{status:restored,parentAccessSuspended:false,parentAccessPreviousStatus:null},$inc:{tokenVersion:1}},
    );
    invalidateTenantUserCache(req.tenant?.code,String(userId));
  }
}


async function assertParentEmailOwnership(req,parent,email){
  const User=req.models?.User; const Parent=req.models?.Parent;
  const normalized=str(email,120).toLowerCase();
  if(!normalized) throw new Error('Parent email is required.');
  if(Parent){
    const duplicate=await Parent.findOne({email:normalized,isDeleted:{$ne:true},...(parent?._id?{_id:{$ne:parent._id}}:{})}).select('_id').lean();
    if(duplicate) throw new Error('Parent email already exists.');
  }
  if(User){
    const other=await User.findOne({email:normalized,deletedAt:null,...(parent?.userId?{_id:{$ne:parent.userId}}:{})}).select('_id roles').lean();
    if(other) throw new Error('That email belongs to another account.');
  }
  return normalized;
}

async function syncParentIdentity(req,parent,previous={}){
  const User=req.models?.User; if(!User||!parent?.userId||!isId(parent.userId)) return;
  const previousChildren=(previous.childrenStudentIds||[]).map(String); const nextChildren=(parent.childrenStudentIds||[]).map(String);
  await User.updateOne({_id:parent.userId,deletedAt:null},{$set:{firstName:parent.firstName,lastName:parent.lastName,email:String(parent.email||'').toLowerCase(),phone:parent.phone||null,childrenStudentIds:nextChildren}});
  invalidateTenantUserCache(req.tenant?.code,String(parent.userId));
  const removed=previousChildren.filter((id)=>!nextChildren.includes(id));
  if(removed.length) invalidateTenantUserCache(req.tenant?.code,String(parent.userId));
}

async function applyParentLifecycle(req,parent,status,{deleting=false,updatedBy=null}={}){
  const next=normalizeParentStatus(status); if(!next) throw new Error('Invalid parent status.');
  parent.status=deleting?'archived':next;
  if(deleting){parent.isDeleted=true;parent.deletedAt=new Date();parent.childrenStudentIds=[];}
  if(updatedBy) parent.updatedBy=updatedBy;
  await parent.save(); await syncParentUserAccess(req,parent,parent.status,{deleting}); return parent;
}

module.exports={PARENT_STATUSES,normalizeParentStatus,validateChildren,assertParentEmailOwnership,syncParentUserAccess,syncParentIdentity,applyParentLifecycle,csvCell};
