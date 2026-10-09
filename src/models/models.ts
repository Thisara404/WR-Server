import { Schema, type Connection } from "mongoose";

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["ADMIN", "MANAGER", "STAFF"], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);
userSchema.index({ email: 1 }, { unique: true });

const workshopSchema = new Schema(
  {
    code: { type: String, required: true },
    title: { type: String, required: true },
    instructor: { type: String, required: true },
    location: { type: String, required: true },
    startsAt: { type: Date, required: true },
    capacity: { type: Number, required: true, min: 1, max: 10000 },
    activeCount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["SCHEDULED", "COMPLETED", "CANCELLED"],
      default: "SCHEDULED",
    },
    version: { type: Number, default: 1 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);
workshopSchema.index({ code: 1 }, { unique: true });
workshopSchema.index({ startsAt: 1, status: 1 });

const registrationSchema = new Schema(
  {
    workshopId: {
      type: Schema.Types.ObjectId,
      ref: "Workshop",
      required: true,
    },
    attendeeName: { type: String, required: true },
    attendeeEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    status: { type: String, enum: ["ACTIVE", "CANCELLED"], default: "ACTIVE" },
    registeredBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    registeredAt: { type: Date, default: Date.now },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: "" },
    requestId: { type: String, required: true },
  },
  { versionKey: false },
);
registrationSchema.index({ requestId: 1 }, { unique: true });
registrationSchema.index(
  { workshopId: 1, attendeeEmail: 1 },
  { unique: true, partialFilterExpression: { status: "ACTIVE" } },
);
registrationSchema.index({ workshopId: 1, registeredAt: -1 });

const eventSchema = new Schema(
  {
    registrationId: {
      type: Schema.Types.ObjectId,
      ref: "Registration",
      required: true,
    },
    workshopId: {
      type: Schema.Types.ObjectId,
      ref: "Workshop",
      required: true,
    },
    event: { type: String, enum: ["REGISTERED", "CANCELLED"], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    occurredAt: { type: Date, default: Date.now },
    note: { type: String, default: "" },
  },
  { versionKey: false },
);
eventSchema.index({ workshopId: 1, occurredAt: -1 });

const auditSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    entityType: { type: String, enum: ["USER", "WORKSHOP"], required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    details: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);
auditSchema.index({ entityType: 1, entityId: 1, occurredAt: -1 });

const loginLimitSchema = new Schema(
  {
    _id: String,
    windowStart: { type: Date, default: Date.now },
    attempts: { type: Number, default: 1 },
  },
  { versionKey: false },
);
loginLimitSchema.index({ windowStart: 1 }, { expireAfterSeconds: 900 });

export function createModels(connection: Connection) {
  return {
    User: connection.models.User ?? connection.model("User", userSchema),
    Workshop:
      connection.models.Workshop ??
      connection.model("Workshop", workshopSchema),
    Registration:
      connection.models.Registration ??
      connection.model("Registration", registrationSchema),
    Event: connection.models.Event ?? connection.model("Event", eventSchema),
    Audit: connection.models.Audit ?? connection.model("Audit", auditSchema),
    LoginLimit:
      connection.models.LoginLimit ??
      connection.model("LoginLimit", loginLimitSchema),
  };
}

export type Models = ReturnType<typeof createModels>;
