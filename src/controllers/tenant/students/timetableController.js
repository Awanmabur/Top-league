const {
  getStudent, mustHaveStudent, getStudentDisplayName, academicMeta, renderView,
} = require("./_helpers");
const { studentTimetableFilter, todayDayCode, currentWeekPattern, weekPatternApplies } = require("../../../services/tenant/timetableService");
const { studentExamFilter } = require("./examsController");

const DAY_ORDER = { Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7 };
const DAY_LABEL = { Mon:"Monday",Tue:"Tuesday",Wed:"Wednesday",Thu:"Thursday",Fri:"Friday",Sat:"Saturday",Sun:"Sunday" };

module.exports = {
  timetable: async (req, res) => {
    try {
      const { TimetableEntry, Subject, Staff, Exam } = req.models || {};
      if (!TimetableEntry || !Subject || !Staff || !Exam) return res.status(503).send("Timetable is not available.");
      const { user, student } = await getStudent(req);
      if (!user) return res.redirect("/login");
      const blocked = mustHaveStudent(res,{tenant:req.tenant,user,student,currentPath:req.originalUrl,pageTitle:"My Timetable"},"students/timetable");
      if (blocked) return blocked;
      let query = TimetableEntry.find(studentTimetableFilter(student));
      query = query.populate({path:"subject",model:Subject,select:"code title shortTitle"}).populate({path:"teacher",model:Staff,select:"firstName lastName fullName"});
      const [entries, exams] = await Promise.all([
        query.sort({dayOfWeek:1,startMinutes:1,createdAt:1}).lean(),
        Exam.find(studentExamFilter(student)).populate({path:"subject",select:"code title shortTitle"}).sort({examDate:1,startTime:1}).limit(6).lean(),
      ]);
      const timezone=req.tenant?.timezone||"UTC", todayDay=todayDayCode(new Date(),timezone), parity=currentWeekPattern(new Date(),timezone);
      const week=entries.sort((a,b)=>(DAY_ORDER[a.dayOfWeek]||99)-(DAY_ORDER[b.dayOfWeek]||99)||Number(a.startMinutes||0)-Number(b.startMinutes||0)).map((e)=>({
        id:String(e._id),day:String(e.dayOfWeek||"").toLowerCase(),dayCode:e.dayOfWeek,dayLabel:DAY_LABEL[e.dayOfWeek]||e.dayOfWeek,time:`${e.startTime||""}${e.endTime?`–${e.endTime}`:""}`,
        courseCode:e.subject?.code||"",courseTitle:e.subject?.title||e.subject?.shortTitle||"Subject",teacherName:e.teacher?.fullName||[e.teacher?.firstName,e.teacher?.lastName].filter(Boolean).join(" ")||"",location:e.room||e.campus||"TBA",type:e.weekPattern==="all"?"Every week":`${e.weekPattern} weeks`,weekPattern:e.weekPattern||"all",
      }));
      const todayClasses=week.filter((e)=>e.dayCode===todayDay&&weekPatternApplies(e.weekPattern,parity));
      const meta=academicMeta(student); meta.semester=`Term ${Number(student.term||1)}`;
      return renderView(req,res,"students/timetable",{pageTitle:"My Timetable",user,student,studentName:getStudentDisplayName(student,user),meta,registrations:[],week,todayClasses,todayDay,todayName:DAY_LABEL[todayDay]||todayDay,weekParity:parity,exams:exams.map((e)=>({title:e.title||e.subject?.title||e.subject?.code||e.code||"Exam",date:e.examDate||null}))});
    } catch(err){console.error("STUDENT TIMETABLE ERROR:",err);return res.status(500).send("Failed to load timetable.");}
  },
};
