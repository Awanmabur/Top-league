const { Schema } = require('mongoose');

module.exports = (connection) => {
  if (!connection) throw new Error('Parent model requires a mongoose connection');
  if (connection.models.Parent) return connection.models.Parent;

  const ParentSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 40 },
    childrenStudentIds: [{ type: Schema.Types.ObjectId, ref: 'Student', index: true }],
    relationship: { type: String, trim: true, maxlength: 60, default: 'Guardian' },
    status: {
      type: String,
      enum: ['active', 'on_hold', 'suspended', 'archived'],
      default: 'active',
      index: true,
    },
    addressLine1: { type: String, trim: true, maxlength: 160, default: '' },
    addressLine2: { type: String, trim: true, maxlength: 160, default: '' },
    city: { type: String, trim: true, maxlength: 100, default: '' },
    country: { type: String, trim: true, maxlength: 100, default: '' },
    occupation: { type: String, trim: true, maxlength: 120, default: '' },
    notes: { type: String, trim: true, maxlength: 1200, default: '' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  }, { timestamps: true });

  ParentSchema.pre('validate', function(next) {
    this.email = String(this.email || '').trim().toLowerCase();
    this.firstName = String(this.firstName || '').trim().replace(/\s+/g, ' ');
    this.lastName = String(this.lastName || '').trim().replace(/\s+/g, ' ');
    next();
  });

  ParentSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
  ParentSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { isDeleted: false, userId: { $type: 'objectId' } } });
  ParentSchema.index({ status: 1, createdAt: -1 });

  return connection.model('Parent', ParentSchema);
};
