const test = require('node:test');
const assert = require('node:assert/strict');
const report = require('../src/services/tenant/reportControlService');
const artifact = require('../src/services/tenant/reportArtifactService');
const analytics = require('../src/controllers/tenant/admin/analyticsController')._test;

function responseFromChunks(chunks, headers = {}) {
  let i = 0;
  return {
    headers: { get(name){ return headers[String(name).toLowerCase()] || null; } },
    body: { getReader(){ return { async read(){ return i < chunks.length ? {done:false,value:chunks[i++]} : {done:true}; }, async cancel(){} }; } },
  };
}

test('CSV cells neutralize spreadsheet formulas',()=>assert.equal(report.csvCell('=2+2'),'\'=2+2'));
test('CSV parser counts quoted multiline values as one record',()=>{const b=Buffer.from('a,b\n"hello\nworld",2\n');assert.equal(report.validateCsvBuffer(b).rowsCount,1);});
test('CSV parser accepts escaped double quotes',()=>{const b=Buffer.from('a,b\n"say ""hi""",2');assert.equal(report.validateCsvBuffer(b).headerCount,2);});
test('CSV parser rejects unterminated quoted values',()=>assert.throws(()=>report.validateCsvBuffer(Buffer.from('a,b\n"x,2')),/unterminated/i));
test('CSV import rejects header-only files',()=>assert.throws(()=>report.validateCsvBuffer(Buffer.from('a,b\n')),/no data rows/i));
test('CSV export validation can allow a header-only artifact',()=>assert.equal(report.validateCsvBuffer(Buffer.from('a,b\n'),{allowHeaderOnly:true}).rowsCount,0));
test('CSV validator rejects binary NUL bytes',()=>assert.throws(()=>report.validateCsvBuffer(Buffer.from([97,44,98,0,10])),/binary/i));
test('CSV validator enforces byte limit',()=>assert.throws(()=>report.validateCsvBuffer(Buffer.from('a,b\n1,2'),{maxBytes:4}),/exceeds/i));
test('CSV validator enforces row limit',()=>assert.throws(()=>report.validateCsvBuffer(Buffer.from('a\n1\n2\n3'),{maxRows:2}),/data rows/i));
test('report filenames remove traversal and control characters',()=>{const x=report.safeFilename('../bad\r\nname.csv','report.csv');assert.doesNotMatch(x,/\/|\\|\r|\n/);assert.doesNotMatch(x,/^\.\./);assert.match(x,/bad/);});
test('revision parser accepts positive integer only',()=>{assert.equal(report.positiveRevision('4'),4);assert.equal(report.positiveRevision('0'),null);assert.equal(report.positiveRevision('1.5'),null);});
test('bounded artifact read rejects oversized content-length before reading',async()=>{const r=responseFromChunks([],{ 'content-length':'101' });await assert.rejects(report.readBoundedResponse(r,100),/exceeds/i);});
test('bounded artifact read rejects streaming body beyond limit',async()=>{const r=responseFromChunks([Buffer.alloc(60),Buffer.alloc(60)]);await assert.rejects(report.readBoundedResponse(r,100),/exceeds/i);});
test('bounded artifact read returns exact concatenated bytes',async()=>{const r=responseFromChunks([Buffer.from('ab'),Buffer.from('cd')]);assert.equal((await report.readBoundedResponse(r,10)).toString(),'abcd');});
test('artifact tenant segment strips path separators and punctuation',()=>assert.equal(artifact.tenantSegment('../School A/UG'),'School-A-UG'));
test('artifact storage fails closed without history model',async()=>await assert.rejects(artifact.storeCsvArtifact({buffer:Buffer.from('a\n'),uploadBuffer:async()=>({})}),/history/i));
test('artifact storage fails closed without storage adapter',async()=>await assert.rejects(artifact.storeCsvArtifact({ReportExport:{},buffer:Buffer.from('a\n')}),/storage/i));
test('artifact storage rejects empty buffers',async()=>await assert.rejects(artifact.storeCsvArtifact({ReportExport:{},uploadBuffer:async()=>({}),buffer:Buffer.alloc(0)}),/empty/i));
test('artifact storage validates malformed CSV before any cloud write',async()=>{let uploads=0;await assert.rejects(artifact.storeCsvArtifact({ReportExport:{create:async()=>({})},uploadBuffer:async()=>{uploads++;return{public_id:'p'};},buffer:Buffer.from('a,b\n\"unterminated'),source:'import'}),/unterminated/i);assert.equal(uploads,0);});
test('artifact storage persists authenticated checksum-bound metadata',async()=>{let saved;const R={create:async(d)=>(saved=d,d)};await artifact.storeCsvArtifact({ReportExport:R,uploadBuffer:async()=>({public_id:'p',resource_type:'raw'}),safeDestroy:async()=>true,tenantCode:'T1',type:'finance_summary',buffer:Buffer.from('a,b\n1,2'),fileName:'x.csv',rowsCount:1});assert.equal(saved.filePublicId,'p');assert.equal(saved.accessType,'authenticated');assert.match(saved.checksum,/^[a-f\d]{64}$/);assert.equal(saved.contentType,'text/csv');});
test('artifact storage permits empty exported datasets with headers',async()=>{let saved;const R={create:async(d)=>(saved=d,d)};await artifact.storeCsvArtifact({ReportExport:R,uploadBuffer:async()=>({public_id:'p',resource_type:'raw'}),safeDestroy:async()=>true,type:'invoices',source:'export',buffer:Buffer.from('Invoice,Amount\n'),fileName:'empty.csv',rowsCount:0});assert.equal(saved.rowsCount,0);});
test('artifact storage compensates cloud upload if history persistence fails',async()=>{let destroyed='';await assert.rejects(artifact.storeCsvArtifact({ReportExport:{create:async()=>{throw new Error('db')}} ,uploadBuffer:async()=>({public_id:'orphan',resource_type:'raw'}),safeDestroy:async(id)=>(destroyed=id,true),type:'payments',buffer:Buffer.from('a\n1'),fileName:'x.csv'}),/db/);assert.equal(destroyed,'orphan');});
test('academic year normalization accepts slash year',()=>assert.equal(analytics.normalizeAcademicYear('2025/2026'),'2025/2026'));
test('academic year normalization rejects query-shaped values',()=>assert.notEqual(analytics.normalizeAcademicYear('$ne:2026'),'$ne:2026'));
test('previous academic year handles single-year values',()=>assert.equal(analytics.previousAcademicYear('2026',2),'2024'));
test('previous academic year handles slash-year values',()=>assert.equal(analytics.previousAcademicYear('2025/2026',1),'2024/2025'));
test('week buckets begin at selected range boundary and end now',()=>{const from=new Date('2026-08-01T00:00:00Z'),to=new Date('2026-08-30T10:00:00Z');const x=analytics.buildWeekBuckets(5,from,to);assert.equal(x.buckets.length,5);assert.equal(x.buckets[0].start.toISOString(),from.toISOString());assert.equal(x.buckets[4].end.toISOString(),to.toISOString());});
test('unsupported school-unit model fails closed',()=>assert.deepEqual(analytics.buildSchoolUnitFilter({schema:{path:()=>null}},'North'),{_id:{$exists:false}}));
test('all-school-unit finance needs no student lookup scope',()=>assert.deepEqual(analytics.studentScopeStages({collection:{name:'students'}},'all'),[]));
test('selected school-unit finance scopes through Student lookup',()=>{const Student={collection:{name:'students'},schema:{path:p=>p==='schoolUnitCode'?{}:null}};const stages=analytics.studentScopeStages(Student,'NORTH');assert.equal(stages[0].$lookup.from,'students');assert.equal(stages[0].$lookup.localField,'studentId');assert.equal(stages[2].$match['__scopeStudent.schoolUnitCode'],'NORTH');});
test('weekly count uses requested range instead of fixed twelve weeks',async()=>{let pipeline;const M={aggregate:async p=>(pipeline=p,[{_id:0,total:3}])};const from=new Date('2026-08-01T00:00:00Z'),to=new Date('2026-08-30T00:00:00Z');const out=await analytics.buildWeeklyCountFast(M,{academicYear:'2026'},5,from,to);assert.equal(out.values.length,5);assert.equal(out.values[0],3);assert.equal(pipeline[0].$match.createdAt.$gte.toISOString(),from.toISOString());assert.equal(pipeline[0].$match.createdAt.$lte.toISOString(),to.toISOString());});
test('weekly payment sum joins Student when a school unit is selected',async()=>{let pipeline;const M={aggregate:async p=>(pipeline=p,[])},Student={collection:{name:'students'},schema:{path:p=>p==='schoolUnitCode'?{}:null}};await analytics.buildWeeklySumFast(M,'amount',{academicYear:'2026',status:'Completed'},4,'paymentDate',{from:new Date('2026-08-01'),to:new Date('2026-08-30'),Student,schoolUnit:'NORTH'});assert.ok(pipeline.some(s=>s.$lookup?.from==='students'));assert.equal(pipeline[0].$match.status,'Completed');assert.ok(pipeline[0].$match.paymentDate);});
