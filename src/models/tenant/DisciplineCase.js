const { Schema } = require("mongoose");
module.exports = (connection) => {
  if (connection.models.DisciplineCase) return connection.models.DisciplineCase;
  const DocSchema = new Schema({
    url:{type:String,required:true,trim:true,maxlength:1200},publicId:{type:String,required:true,trim:true,maxlength:300},resourceType:{type:String,trim:true,maxlength:20,default:"auto"},originalName:{type:String,trim:true,maxlength:200,default:""},bytes:{type:Number,default:0,min:0},mimeType:{type:String,trim:true,maxlength:100,default:""},uploadedAt:{type:Date,default:Date.now},uploadedBy:{type:Schema.Types.ObjectId,ref:"User",default:null}
  },{_id:false});
  const ActionSchema = new Schema({
    action:{type:String,required:true,trim:true,maxlength:120},details:{type:String,trim:true,maxlength:800,default:""},date:{type:Date,default:Date.now},by:{type:Schema.Types.ObjectId,ref:"User",default:null},visibleToStudent:{type:Boolean,default:false},visibleToParent:{type:Boolean,default:false}
  },{_id:false});
  const DisciplineCaseSchema = new Schema({
    caseNo:{type:String,required:true,trim:true,maxlength:40},student:{type:Schema.Types.ObjectId,ref:"Student",required:true,index:true},studentRegNo:{type:String,trim:true,maxlength:60,default:""},studentName:{type:String,trim:true,maxlength:120,default:""},classId:{type:String,trim:true,maxlength:80,default:"",index:true},className:{type:String,trim:true,maxlength:180,default:""},academicYear:{type:String,trim:true,maxlength:20,default:"",index:true},term:{type:Number,min:1,max:3,default:null,index:true},incidentDate:{type:Date,required:true,index:true},category:{type:String,required:true,trim:true,maxlength:80,index:true},description:{type:String,required:true,trim:true,maxlength:1500},status:{type:String,enum:["open","investigating","hearing","resolved","dismissed"],default:"open",index:true},studentVisible:{type:Boolean,default:false,index:true},parentVisible:{type:Boolean,default:false,index:true},publishedAt:{type:Date,default:null},publishedBy:{type:Schema.Types.ObjectId,ref:"User",default:null},resolutionSummary:{type:String,trim:true,maxlength:1200,default:""},resolvedAt:{type:Date,default:null},resolvedBy:{type:Schema.Types.ObjectId,ref:"User",default:null},reopenedAt:{type:Date,default:null},reopenedBy:{type:Schema.Types.ObjectId,ref:"User",default:null},studentStatement:{type:DocSchema,default:null},attachments:{type:[DocSchema],default:[]},actions:{type:[ActionSchema],default:[]},note:{type:String,trim:true,maxlength:800,default:""},revision:{type:Number,default:0,min:0},migrationQuarantinedAt:{type:Date,default:null,index:true},migrationQuarantineReason:{type:String,trim:true,maxlength:500,default:""},createdBy:{type:Schema.Types.ObjectId,ref:"User",default:null},updatedBy:{type:Schema.Types.ObjectId,ref:"User",default:null},isDeleted:{type:Boolean,default:false,index:true},deletedAt:{type:Date,default:null},deletedBy:{type:Schema.Types.ObjectId,ref:"User",default:null}
  },{timestamps:true});
  DisciplineCaseSchema.index({caseNo:1},{unique:true,partialFilterExpression:{isDeleted:false}});
  DisciplineCaseSchema.index({student:1,incidentDate:-1,status:1});
  DisciplineCaseSchema.index({studentVisible:1,parentVisible:1,status:1,incidentDate:-1});
  DisciplineCaseSchema.methods.softDelete=async function(userId=null){this.isDeleted=true;this.deletedAt=new Date();this.deletedBy=userId||null;await this.save();};
  return connection.model("DisciplineCase",DisciplineCaseSchema);
};
