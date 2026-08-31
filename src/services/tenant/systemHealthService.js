const TYPES=new Set(['Application','Database','Storage','Queue','Integration']);
const STATUSES=new Set(['Healthy','Warning','Critical','Maintenance']);
function str(v,max=500){return String(v??'').trim().slice(0,max);}
function pct(v, fallback='—'){const n=Number(String(v??'').replace('%',''));if(!Number.isFinite(n))return fallback;return `${Math.max(0,Math.min(100,n)).toFixed(2)}%`;}
function latency(v,fallback='—'){const n=Number(String(v??'').replace(/ms/i,''));return Number.isFinite(n)&&n>=0?`${Math.round(n)}ms`:fallback;}
function buildValues(input={}, current=null, actorId=null, now=new Date()){
 const serviceName=str(input.serviceName||current?.serviceName,220);if(!serviceName)throw new Error('Service name is required.');
 const type=TYPES.has(str(input.type||current?.type))?str(input.type||current?.type):'Application';
 const status=STATUSES.has(str(input.status||current?.status))?str(input.status||current?.status):'Warning';
 const prev=current?.status||null; const revision=Number(current?.revision||0)+1;
 const out={serviceName,type,region:str(input.region??current?.region,100),status,notes:str(input.note??input.notes??current?.notes,1000),metrics:{uptime:pct(input.uptime??current?.metrics?.uptime),latency:latency(input.latency??current?.metrics?.latency),load:str((input.load ?? current?.metrics?.load ?? '—'),40),errorRate:pct(input.errorRate??current?.metrics?.errorRate,'—'),cpu:pct(input.cpu??current?.metrics?.cpu,'—'),memory:pct(input.memory??current?.metrics?.memory,'—')},lastCheckedAt:now,updatedBy:actorId,revision};
 if(!current)out.createdBy=actorId;
 if(prev!==status){out.lastIncidentAt=status==='Healthy'?current?.lastIncidentAt||null:now;out.incident={actorUserId:actorId,actorName:str(input.actorName||'System',180),type:status==='Maintenance'?'Maintenance':'Incident',status:status==='Healthy'?'Resolved':status==='Maintenance'?'Maintenance':'Open',note:str(input.note||`Status changed${prev?` from ${prev}`:''} to ${status}.`,1000),fromStatus:prev||'',toStatus:status,createdAt:now};}
 return out;
}
function assertRevision(current, expected){if(Number(current?.revision||0)!==Number(expected))throw new Error('System health item changed in another session. Reload and try again.');return true;}
function applicationProbe(now=new Date()){const mem=process.memoryUsage();const used=mem.rss;const total=Math.max(used,require('os').totalmem());return {status:'Healthy',uptime:'—',latency:'—',load:require('os').loadavg()[0].toFixed(2),errorRate:'—',cpu:'—',memory:`${Math.min(100,(used/total)*100).toFixed(2)}%`,processUptimeSeconds:Math.max(0,Math.floor(process.uptime())),checkedAt:now};}
module.exports={TYPES,STATUSES,str,pct,latency,buildValues,assertRevision,applicationProbe};
