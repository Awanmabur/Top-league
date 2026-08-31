const { Schema } = require("mongoose");
module.exports = (connection) => {
  if (connection.models.StudentDoc) return connection.models.StudentDoc;
  const DocSchema = new Schema({
    url:{type:String,required:true,trim:true,maxlength:1200},publicId:{type:String,required:true,trim:true,maxlength:300},resourceType:{type:String,trim:true,maxlength:20,default:"auto"},originalName:{type:String,trim:true,maxlength:200,default:""},bytes:{type:Number,default:0,min:0},mimeType:{type:String,trim:true,maxlength:100,default:""},source:{type:String,trim:true,maxlength:40,default:""},sharedAsset:{type:Boolean,default:false},uploadedAt:{type:Date,default:Date.now}
  },{_id:false});
  const StudentDocSchema = new Schema({
    student:{type:Schema.Types.ObjectId,ref:"Student",required:true,index:true},type:{type:String,enum:["passport","id","transcript","certificate","other"],default:"other",index:true},title:{type:String,required:true,trim:true,maxlength:180},doc:{type:DocSchema,required:true},status:{type:String,enum:["pending","verified","rejected","expired"],default:"pending",index:true},issueDate:{type:Date,default:null},expiryDate:{type:Date,default:null,index:true},verifiedAt:{type:Date,default:null},verifiedBy:{type:Schema.Types.ObjectId,ref:"User",default:null},rejectionReason:{type:String,trim:true,maxlength:500,default:""},studentVisible:{type:Boolean,default:true,index:true},parentVisible:{type:Boolean,default:true,index:true},uploadedBy:{type:Schema.Types.ObjectId,ref:"User",default:null},sourceApplicant:{type:Schema.Types.ObjectId,ref:"Applicant",default:null,index:true},updatedBy:{type:Schema.Types.ObjectId,ref:"User",default:null},revision:{type:Number,default:0,min:0},migrationQuarantinedAt:{type:Date,default:null,index:true},migrationQuarantineReason:{type:String,trim:true,maxlength:500,default:""},isDeleted:{type:Boolean,default:false,index:true},deletedAt:{type:Date,default:null},deletedBy:{type:Schema.Types.ObjectId,ref:"User",default:null}
  },{timestamps:true});
  StudentDocSchema.index({createdAt:-1});
  StudentDocSchema.index({student:1,type:1,isDeleted:1});
  StudentDocSchema.index({student:1,status:1,expiryDate:1,isDeleted:1});
  StudentDocSchema.methods.softDelete=async function(userId=null){this.isDeleted=true;this.deletedAt=new Date();this.deletedBy=userId||null;await this.save();};
  return connection.model("StudentDoc",StudentDocSchema);
};
