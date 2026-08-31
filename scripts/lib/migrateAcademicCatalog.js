const { syncEnrollmentCounts } = require('../../src/services/tenant/academicCatalogService');

const str = (v, max = 180) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
function code(v, fallback = 'ITEM') {
  const out = str(v, 80).toUpperCase().replace(/&/g,'AND').replace(/[^A-Z0-9-]+/g,'-').replace(/-{2,}/g,'-').replace(/(^-|-$)/g,'').slice(0,40);
  return out || fallback;
}
function uniqueCandidate(base, id, attempt = 0) {
  const suffix = `${String(id).slice(-6).toUpperCase()}${attempt ? `-${attempt}` : ''}`;
  return `${code(base,'ITEM').slice(0, Math.max(1, 39-suffix.length))}-${suffix}`.slice(0,40);
}
async function repairCodes(Model, prefix) {
  if (!Model) return { scanned:0, repaired:0 };
  const docs = await Model.find({}).select('_id code name title status').sort({ createdAt:1, _id:1 }).lean();
  const used = new Set(); let repaired=0;
  for (const row of docs) {
    let next = code(row.code || row.name || row.title, `${prefix}-${String(row._id).slice(-6)}`);
    if (used.has(next)) {
      let attempt=0; do { next=uniqueCandidate(next,row._id,attempt++); } while(used.has(next) && attempt<50);
    }
    used.add(next);
    const set={}; if(String(row.code||'')!==next) set.code=next;
    const allowed = prefix==='SUBJ' ? ['active','draft','archived'] : ['active','inactive','archived'];
    if(!allowed.includes(String(row.status||'').toLowerCase())) set.status=prefix==='SUBJ'?'draft':'inactive';
    if(Object.keys(set).length){await Model.collection.updateOne({_id:row._id},{$set:set});repaired+=1;}
  }
  return { scanned:docs.length, repaired };
}

async function migrateAcademicCatalog(models = {}) {
  const { Class, Section, Stream, Subject } = models;
  const classes = await repairCodes(Class,'CLASS');
  const sections = await repairCodes(Section,'SEC');
  const streams = await repairCodes(Stream,'STR');
  const subjects = await repairCodes(Subject,'SUBJ');
  let orphanedArchived=0, linksNormalized=0;

  const classMap = new Map(((await Class?.find({}).select('_id name code classLevel schoolUnitId schoolUnitName campusId campusName levelType').lean())||[]).map((x)=>[String(x._id),x]));
  const sectionMap = new Map(((await Section?.find({}).select('_id name code classId status').lean())||[]).map((x)=>[String(x._id),x]));
  const streamMap = new Map(((await Stream?.find({}).select('_id name code classId sectionId status').lean())||[]).map((x)=>[String(x._id),x]));

  if (Section) {
    for (const row of await Section.find({}).lean()) {
      const parent=classMap.get(String(row.classId||'')); const set={};
      if(!parent){ if(row.status!=='archived') set.status='archived'; }
      else {
        if(row.className!==parent.name) set.className=parent.name||'';
        if(row.classCode!==parent.code) set.classCode=parent.code||'';
        if(row.classLevel!==parent.classLevel) set.classLevel=parent.classLevel||'';
      }
      if(row.streamId && !streamMap.has(String(row.streamId))) { set.streamId=null; set.streamName=''; set.streamCode=''; }
      if(Object.keys(set).length){await Section.collection.updateOne({_id:row._id},{$set:set});linksNormalized+=1;if(set.status==='archived')orphanedArchived+=1;}
    }
  }
  if (Stream) {
    for (const row of await Stream.find({}).lean()) {
      const parent=classMap.get(String(row.classId||'')); const section=row.sectionId?sectionMap.get(String(row.sectionId)):null; const set={};
      if(!parent){ if(row.status!=='archived') set.status='archived'; }
      else { if(row.className!==parent.name)set.className=parent.name||''; if(row.classCode!==parent.code)set.classCode=parent.code||''; if(row.classLevel!==parent.classLevel)set.classLevel=parent.classLevel||''; }
      if(row.sectionId&&!section){set.sectionId=null;set.sectionName='';set.sectionCode='';}
      else if(section){if(row.sectionName!==section.name)set.sectionName=section.name||'';if(row.sectionCode!==section.code)set.sectionCode=section.code||'';}
      if(Object.keys(set).length){await Stream.collection.updateOne({_id:row._id},{$set:set});linksNormalized+=1;if(set.status==='archived')orphanedArchived+=1;}
    }
  }
  if (Subject) {
    for (const row of await Subject.find({}).lean()) {
      const parent=classMap.get(String(row.classId||'')); const section=row.sectionId?sectionMap.get(String(row.sectionId)):null; const stream=row.streamId?streamMap.get(String(row.streamId)):null; const set={};
      if(!parent){if(row.status!=='archived')set.status='archived';}
      else {for(const [key,val] of [['className',parent.name||''],['classCode',parent.code||''],['classLevel',parent.classLevel||''],['schoolUnitId',parent.schoolUnitId||''],['schoolUnitName',parent.schoolUnitName||''],['campusId',parent.campusId||''],['campusName',parent.campusName||''],['levelType',parent.levelType||'']])if(String(row[key]||'')!==String(val))set[key]=val;}
      if(row.sectionId&&!section){set.sectionId='';set.sectionName='';set.sectionCode='';}
      else if(section){if(row.sectionName!==section.name)set.sectionName=section.name||'';if(row.sectionCode!==section.code)set.sectionCode=section.code||'';}
      if(row.streamId&&!stream){set.streamId='';set.streamName='';set.streamCode='';}
      else if(stream){if(row.streamName!==stream.name)set.streamName=stream.name||'';if(row.streamCode!==stream.code)set.streamCode=stream.code||'';}
      if(Object.keys(set).length){await Subject.collection.updateOne({_id:row._id},{$set:set});linksNormalized+=1;if(set.status==='archived')orphanedArchived+=1;}
    }
  }
  const enrollmentSync = await syncEnrollmentCounts(models);
  return { classes, sections, streams, subjects, orphanedArchived, linksNormalized, enrollmentSync };
}
module.exports = { migrateAcademicCatalog, repairCodes, code };
