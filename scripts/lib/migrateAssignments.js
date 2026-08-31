const { safeHttpUrl, normalizeAssignmentStatus, normalizeSubmissionStatus } = require("../../src/services/tenant/assignmentService");

const SUBMISSION_INDEX_NAME = "uniq_active_assignment_student_submission";
const SUBMISSION_INDEX_KEY = Object.freeze({ assignment: 1, student: 1 });
const str = (v, max = 500) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const idText = (v) => (v && typeof v === "object" && v._id ? String(v._id) : String(v || ""));

function legacyAssignmentStatus(row = {}) {
  const raw = str(row.status, 40).toLowerCase().replace(/[\s_-]+/g, "");
  if (["published","active","open","visible","assigned"].includes(raw)) return "published";
  if (["closed","completed","complete","expired","locked"].includes(raw)) return "closed";
  if (["archived","deleted","inactive"].includes(raw)) return "archived";
  return "draft";
}

function legacySubmissionStatus(row = {}) {
  const raw = str(row.status, 40).toLowerCase().replace(/[\s_-]+/g, "");
  if (["graded","marked","reviewed","returned"].includes(raw) || row.gradedAt || row.score != null || row.mark != null) return "graded";
  if (["submitted","turnedin","sent"].includes(raw) || row.submittedAt) return "submitted";
  return "draft";
}

function keysEqual(a = {}, b = {}) {
  return JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));
}

async function dropConflictingSubmissionIndexes(AssignmentSubmission) {
  if (!AssignmentSubmission?.collection?.indexes || !AssignmentSubmission?.collection?.dropIndex) return 0;
  let indexes=[]; try { indexes=await AssignmentSubmission.collection.indexes(); } catch { return 0; }
  let dropped=0;
  for(const idx of indexes){
    if(idx.name==="_id_")continue;
    const sameKey=keysEqual(idx.key,SUBMISSION_INDEX_KEY);
    if(!sameKey&&idx.name!==SUBMISSION_INDEX_NAME)continue;
    const partial=idx.partialFilterExpression||{};
    const desired=idx.name===SUBMISSION_INDEX_NAME&&idx.unique===true&&Object.prototype.hasOwnProperty.call(partial,"migrationQuarantinedAt");
    if(desired)continue;
    await AssignmentSubmission.collection.dropIndex(idx.name); dropped+=1;
  }
  return dropped;
}

async function ensureSubmissionIndex(AssignmentSubmission) {
  if(!AssignmentSubmission?.collection?.createIndex)return false;
  await AssignmentSubmission.collection.createIndex(SUBMISSION_INDEX_KEY,{unique:true,name:SUBMISSION_INDEX_NAME,partialFilterExpression:{migrationQuarantinedAt:null}});
  return true;
}

function preferredSubmissionScore(row = {}) {
  const status = legacySubmissionStatus(row);
  return [status === "graded" ? 3 : status === "submitted" ? 2 : 1, Number(row.revision || 0), new Date(row.lastSubmittedAt || row.submittedAt || row.updatedAt || row.createdAt || 0).getTime() || 0];
}
function comparePreferred(a,b){const aa=preferredSubmissionScore(a),bb=preferredSubmissionScore(b);for(let i=0;i<aa.length;i+=1)if(aa[i]!==bb[i])return bb[i]-aa[i];return idText(a._id).localeCompare(idText(b._id));}

async function migrateAssignments(models = {}) {
  const { Assignment, AssignmentSubmission, Subject, Class, Student } = models;
  if (!Assignment || !AssignmentSubmission || !Subject || !Class || !Student) return { skipped: true, reason: "Assignment, AssignmentSubmission, Subject, Class and Student models are required" };
  const droppedIndexes = await dropConflictingSubmissionIndexes(AssignmentSubmission);
  const [assignmentRows, submissionRows, subjects, classes, students] = await Promise.all([
    Assignment.collection.find({}).toArray(), AssignmentSubmission.collection.find({}).toArray(), Subject.collection.find({}).toArray(), Class.collection.find({}).toArray(), Student.collection.find({}).toArray(),
  ]);
  const subjectById=new Map(subjects.map((x)=>[idText(x._id),x]));
  const subjectByCode=new Map(subjects.map((x)=>[str(x.code,40).toUpperCase(),x]).filter(([k])=>k));
  const classById=new Map(classes.map((x)=>[idText(x._id),x]));
  const assignmentById=new Map();
  const studentById=new Map(students.map((x)=>[idText(x._id),x]));
  let assignmentsNormalized=0, assignmentsQuarantined=0;

  for(const row of assignmentRows){
    let subject=subjectById.get(idText(row.course||row.subject||row.courseId))||subjectByCode.get(str(row.subjectCode||row.courseCode,40).toUpperCase())||null;
    let classDoc=classById.get(idText(row.classGroup||row.classId))||classById.get(idText(subject?.classId))||null;
    const reasons=[];
    const title=str(row.title||row.name,200); if(!title)reasons.push("Assignment title is missing.");
    if(!subject)reasons.push("Linked subject could not be resolved.");
    if(!classDoc)reasons.push("Linked class could not be resolved.");
    const status=legacyAssignmentStatus(row);
    let totalPoints=Number(row.totalPoints ?? row.maxMarks ?? row.marks ?? 100); if(!Number.isFinite(totalPoints)||totalPoints<0||totalPoints>1000){reasons.push("Total points are invalid.");totalPoints=100;}
    let dueDate=row.dueDate||row.deadline||null; if(dueDate&&Number.isNaN(new Date(dueDate).getTime())){reasons.push("Due date is invalid.");dueDate=null;}
    const academicYear=str(row.academicYear||subject?.academicYear||classDoc?.academicYear,20);
    const term=Number(row.term||subject?.term||classDoc?.term||1); if(![1,2,3].includes(term))reasons.push("Academic term is invalid.");
    const attachments=(Array.isArray(row.attachments)?row.attachments:[]).map(safeHttpUrl).filter(Boolean).slice(0,30);
    const quarantinedAt=reasons.length?(row.migrationQuarantinedAt||new Date()):null; if(reasons.length)assignmentsQuarantined+=1;
    const set={
      title,course:subject?._id||row.course||null,courseName:str(row.courseName||subject?.title||subject?.code,160),classGroup:classDoc?._id||null,className:str(row.className||classDoc?.name,180),
      sectionId:row.sectionId||subject?.sectionId||null,sectionName:str(row.sectionName||subject?.sectionName,100),streamId:row.streamId||subject?.streamId||null,streamName:str(row.streamName||subject?.streamName,100),
      academicYear,term:[1,2,3].includes(term)?term:1,dueDate:dueDate?new Date(dueDate):null,totalPoints,allowLateSubmissions:!!row.allowLateSubmissions,instructions:str(row.instructions||row.description,4000),rubric:str(row.rubric,4000),attachments,
      status:reasons.length?"archived":status,publishedAt:!reasons.length&&status==="published"?(row.publishedAt||row.createdAt||new Date()):null,closedAt:!reasons.length&&status==="closed"?(row.closedAt||row.updatedAt||new Date()):null,archivedAt:(reasons.length||status==="archived")?(row.archivedAt||row.updatedAt||new Date()):null,
      revision:Math.max(0,Number(row.revision||0)),migrationQuarantinedAt:quarantinedAt,migrationQuarantineReason:reasons.join(" ").slice(0,500),
    };
    await Assignment.collection.updateOne({_id:row._id},{$set:set}); assignmentById.set(idText(row._id),{...row,...set,_id:row._id}); assignmentsNormalized+=1;
  }

  const normalizedSubmissions=[]; let submissionsNormalized=0, submissionsQuarantined=0;
  for(const row of submissionRows){
    const assignment=assignmentById.get(idText(row.assignment||row.assignmentId))||null;
    const student=studentById.get(idText(row.student||row.studentId))||null;
    const reasons=[]; if(!assignment||assignment.migrationQuarantinedAt)reasons.push("Linked assignment could not be resolved safely."); if(!student||student.isDeleted===true)reasons.push("Linked student could not be resolved safely.");
    let status=legacySubmissionStatus(row); const max=Number(assignment?.totalPoints??100); let score=row.score??row.mark??row.marks??null;
    if(status==="graded"){score=Number(score);if(!Number.isFinite(score)||score<0||score>max){reasons.push("Graded score is outside assignment bounds.");status="submitted";score=null;}}
    const quarantinedAt=reasons.length?(row.migrationQuarantinedAt||new Date()):null; if(reasons.length)submissionsQuarantined+=1;
    const set={assignment:assignment?._id||row.assignment||null,student:student?._id||row.student||null,text:str(row.text||row.answer||row.submissionText,12000),attachmentUrls:(Array.isArray(row.attachmentUrls)?row.attachmentUrls:Array.isArray(row.attachments)?row.attachments:[]).map(safeHttpUrl).filter(Boolean).slice(0,10),status,submittedAt:row.submittedAt||null,lastSubmittedAt:row.lastSubmittedAt||row.submittedAt||null,isLate:!!row.isLate,revision:Math.max(0,Number(row.revision||0)),score:status==="graded"?score:null,percentage:status==="graded"&&max>0?Math.round((score/max)*10000)/100:null,feedback:str(row.feedback||row.comments,4000),gradedAt:status==="graded"?(row.gradedAt||row.updatedAt||new Date()):null,gradeRevision:Math.max(0,Number(row.gradeRevision||0)),migrationQuarantinedAt:quarantinedAt,migrationQuarantineReason:reasons.join(" ").slice(0,500)};
    await AssignmentSubmission.collection.updateOne({_id:row._id},{$set:set}); normalizedSubmissions.push({...row,...set,_id:row._id}); submissionsNormalized+=1;
  }

  const groups=new Map();
  for(const row of normalizedSubmissions){if(row.migrationQuarantinedAt||!row.assignment||!row.student)continue;const key=`${idText(row.assignment)}:${idText(row.student)}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  let duplicateGroups=0,duplicatesQuarantined=0;
  for(const matches of groups.values()){
    if(matches.length<2)continue;duplicateGroups+=1;matches.sort(comparePreferred);const keep=matches[0];
    for(const dup of matches.slice(1)){await AssignmentSubmission.collection.updateOne({_id:dup._id},{$set:{migrationQuarantinedAt:dup.migrationQuarantinedAt||new Date(),migrationQuarantineReason:`Duplicate assignment/student submission; retained ${keep._id}.`.slice(0,500)}});duplicatesQuarantined+=1;}
  }
  const indexCreated=await ensureSubmissionIndex(AssignmentSubmission);
  return {assignmentsScanned:assignmentRows.length,assignmentsNormalized,assignmentsQuarantined,submissionsScanned:submissionRows.length,submissionsNormalized,submissionsQuarantined,duplicateGroups,duplicatesQuarantined,droppedIndexes,indexCreated};
}

module.exports={SUBMISSION_INDEX_NAME,SUBMISSION_INDEX_KEY,legacyAssignmentStatus,legacySubmissionStatus,dropConflictingSubmissionIndexes,ensureSubmissionIndex,migrateAssignments};
