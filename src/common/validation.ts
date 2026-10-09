import { z } from "zod";

export const roles = ["ADMIN", "MANAGER", "STAFF"] as const;
export type Role = (typeof roles)[number];

export const statuses = ["SCHEDULED", "COMPLETED", "CANCELLED"] as const;

const email = z.string().trim().toLowerCase().pipe(z.email().max(200));

export const loginSchema = z
  .object({ email, password: z.string().min(1).max(200) })
  .strict();

export const userSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email,
    password: z.string().min(10).max(200),
    role: z.enum(roles),
  })
  .strict();

export const workshopSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/)
      .transform((value) => value.toUpperCase()),
    title: z.string().trim().min(2).max(160),
    instructor: z.string().trim().min(2).max(100),
    location: z.string().trim().min(2).max(100),
    startsAt: z.iso.datetime({ offset: true }),
    capacity: z.number().int().min(1).max(10000),
    status: z.enum(statuses).default("SCHEDULED"),
  })
  .strict();

export const updateWorkshopSchema = workshopSchema.extend({
  expectedVersion: z.number().int().positive(),
});

export const registrationSchema = z
  .object({
    attendeeName: z.string().trim().min(2).max(100),
    attendeeEmail: email,
    requestId: z.uuid(),
  })
  .strict();

export const cancellationSchema = z
  .object({ reason: z.string().trim().max(300).default("") })
  .strict();

export const idSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid record ID");

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
    "Invalid date",
  );

export const filterSchema = z
  .object({
    from: date.optional(),
    to: date.optional(),
    status: z.enum(statuses).optional(),
    available: z.enum(["true", "false"]).default("false"),
    search: z.string().trim().max(100).default(""),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    "Start date must be before end date",
  );
