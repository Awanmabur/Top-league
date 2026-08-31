const crypto = require('crypto');
const STATUSES = Object.freeze(['active','inactive','maintenance','archived']);
const str=(v,max=200)=>String(v==null?'':v).trim().replace(/\s+/g,' ').slice(0,max);
const idText=(v)=>String(v?._id||v||'');
function routeCode(v){return str(v,40).toUpperCase().replace(/[^A-Z0-9-]+/g,'-').replace(/-{2,}/g,'-').replace(/(^-|-$)/g,'');}
function normalizeStatus(v,fallback='inactive'){const x=str(v,20).toLowerCase()||fallback;if(!STATUSES.includes(x))throw new Error('Invalid transport status.');return x;}
function pickupPoints(v){const a=Array.isArray(v)?v:String(v||'').split(/\r?\n|,/);return [...new Set(a.map(x=>str(x,120)).filter(Boolean))].slice(0,100);}
function csvCell(v){let s=String(v==null?'':v);if(/^[=+\-@\t\r]/.test(s))s=`'${s}`;return `"${s.replace(/"/g,'""')}"`;}
function escapeRegExp(v){return String(v||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function committedSeats(route,activeAssignmentCount=0){return Math.max(0,Number(activeAssignmentCount||0))+Math.max(0,Number(route?.legacyAssignedLearners||0));}
function assertCapacity(capacity,used){const c=Number(capacity);if(!Number.isInteger(c)||c<1)throw new Error('Transport capacity must be at least 1.');if(c<Number(used||0))throw new Error('Capacity cannot be lower than committed learner seats.');return c;}
function assertTransition(current,next){const from=normalizeStatus(current?.status||'inactive'),to=normalizeStatus(next,from);if(from==='archived'&&to!=='archived')throw new Error('Archived transport routes are immutable.');return to;}
function buildRouteValues({input={},current=null,activeAssignmentCount=0,actorId=null,now=new Date()}){
 const status=current?assertTransition(current,input.status||current.status):normalizeStatus(input.status,'inactive');
 const cap=assertCapacity(input.capacity??current?.capacity??1,committedSeats(current,activeAssignmentCount));
 const values={routeName:str(input.routeName??current?.routeName,160),routeCode:routeCode(input.routeCode??current?.routeCode),vehicleName:str(input.vehicleName??current?.vehicleName,120),vehicleRegNo:str(input.vehicleRegNo??current?.vehicleRegNo,40).toUpperCase(),driverName:str(input.driverName??current?.driverName,120),driverPhone:str(input.driverPhone??current?.driverPhone,40),pickupPoints:pickupPoints(input.pickupPoints??current?.pickupPoints),feeAmount:Math.max(0,Number(input.feeAmount??current?.feeAmount??0)||0),capacity:cap,status,notes:str(input.notes??current?.notes,1000),revision:Number(current?.revision||0)+1,updatedBy:actorId||null};
 if(!values.routeName||!values.routeCode)throw new Error('Route name and route code are required.');
 if(!current)values.createdBy=actorId||null;
 if(status==='active'&&!current?.firstActivatedAt)values.firstActivatedAt=now;
 else if(current?.firstActivatedAt)values.firstActivatedAt=current.firstActivatedAt;
 if(status==='archived')values.archivedAt=current?.archivedAt||now;
 else if(current?.archivedAt)values.archivedAt=current.archivedAt;
 return values;
}
function assertAssignableRoute(route){if(!route||route.isDeleted===true||route.status!=='active')throw new Error('Only an active transport route can receive learner assignments.');}
function assertStudentAssignable(student){if(!student||student.isDeleted===true||student.status!=='active')throw new Error('Only an active student can be assigned to transport.');}
function normalizePickupForRoute(route,pickup){const p=str(pickup,120);if(!p)throw new Error('Pickup point is required.');const points=pickupPoints(route?.pickupPoints);if(!points.some(x=>x.toLowerCase()===p.toLowerCase()))throw new Error('Pickup point is not part of this route.');return points.find(x=>x.toLowerCase()===p.toLowerCase());}
function buildAssignmentValues({route,student,pickupPoint,actorId=null,now=new Date()}){assertAssignableRoute(route);assertStudentAssignable(student);return{route:route._id||route,student:student._id||student,studentRegNo:str(student.regNo,60),studentName:str(student.fullName||[student.firstName,student.lastName].filter(Boolean).join(' '),160),pickupPoint:normalizePickupForRoute(route,pickupPoint),feeAmountSnapshot:Math.max(0,Number(route.feeAmount||0)||0),status:'active',startedAt:now,endedAt:null,revision:1,createdBy:actorId||null,updatedBy:actorId||null,migrationQuarantinedAt:null,migrationQuarantineReason:''};}
function endAssignmentValues(current,actorId=null,now=new Date()){if(!current||current.status!=='active')throw new Error('Only an active transport assignment can be ended.');return{status:'ended',endedAt:now,revision:Number(current.revision||1)+1,updatedBy:actorId||null};}
function newAssignmentCode(now=new Date()){const d=now.toISOString().slice(0,10).replace(/-/g,'');return `TR-${d}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;}
function assertDeleteAllowed(route,assignmentCount=0){if(!route)throw new Error('Transport route is required.');if(route.status!=='inactive'||route.firstActivatedAt||Number(assignmentCount||0)>0||Number(route.legacyAssignedLearners||0)>0)throw new Error('Only a never-activated unused inactive route can be permanently deleted. Archive operational routes instead.');return true;}
function studentAssignmentFilter(studentId){return{student:studentId,status:'active',isDeleted:{$ne:true},migrationQuarantinedAt:null};}
module.exports={STATUSES,str,routeCode,normalizeStatus,pickupPoints,csvCell,escapeRegExp,committedSeats,assertCapacity,assertTransition,buildRouteValues,assertAssignableRoute,assertStudentAssignable,normalizePickupForRoute,buildAssignmentValues,endAssignmentValues,newAssignmentCode,assertDeleteAllowed,studentAssignmentFilter,idText};
