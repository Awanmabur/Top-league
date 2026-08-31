const { getStaffProfile, isValidId } = require("./_helpers");
const { loadPortalNotifications, markPortalNotificationRead, markAllPortalNotificationsRead, getPreference, savePreference, CATEGORY_FIELDS, portalNotificationFilter, directNotificationOwnershipFilter } = require("../../../services/tenant/notificationService");
// Keep the underlying visibility/ownership contracts explicit for audits while receipt state is applied by loadPortalNotifications.
void portalNotificationFilter;
void directNotificationOwnershipFilter;
const { markMessageOpenedFromNotification } = require("../../../services/tenant/messageService");
function preferenceInput(body={}){const out={inApp:body.inApp==="on"||body.inApp==="true"||body.inApp===true};CATEGORY_FIELDS.forEach(k=>{out[k]=k==="system"?true:(body[k]==="on"||body[k]==="true"||body[k]===true);});return out;}
module.exports={
  async list(req,res){try{const {user,staff}=await getStaffProfile(req);if(!user)return res.redirect("/login");const [items,preference]=await Promise.all([loadPortalNotifications(req.models,user,["staff"],{limit:200}),getPreference(req.models,user)]);return res.render("staff/notifications",{tenant:req.tenant,user,staff,items:items.map(x=>({...x,isRead:!!x.effectiveRead,readAt:x.effectiveReadAt||null})),preference,preferenceCategories:CATEGORY_FIELDS,pageTitle:"Notifications",error:null});}catch(err){console.error("STAFF NOTIFICATIONS LIST ERROR:",err);return res.status(500).send("Failed to load notifications");}},
  async read(req,res){try{const {user}=await getStaffProfile(req);if(!user)return res.redirect("/login");const id=req.params.id;if(!isValidId(id))return res.redirect("/staff/notifications");const notification=await markPortalNotificationRead(req.models,user,id,["staff"]);if(notification)await markMessageOpenedFromNotification(req,notification,user).catch(()=>{});}catch{}return res.redirect("/staff/notifications");},
  async markAllRead(req,res){try{const {user}=await getStaffProfile(req);if(user)await markAllPortalNotificationsRead(req.models,user,["staff"]);}catch{}return res.redirect("/staff/notifications");},
  async savePreferences(req,res){try{const {user}=await getStaffProfile(req);if(!user)return res.redirect("/login");await savePreference(req.models,user,preferenceInput(req.body));req.flash?.("success","Notification preferences updated.");}catch(err){req.flash?.("error",err.message||"Could not update preferences.");}return res.redirect("/staff/notifications");},
};
