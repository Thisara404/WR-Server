import {
  Inject,
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import type { z } from "zod";
import { DatabaseService } from "./database.service";
import type { User } from "../security/security";
import {
  filterSchema,
  workshopSchema,
  updateWorkshopSchema,
  registrationSchema,
} from "../common/validation";

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

@Injectable()
export class WorkshopsService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async list(input: z.infer<typeof filterSchema>) {
    const filter: Record<string, any> = {};
    if (input.search) {
      const search = new RegExp(escapeRegex(input.search), "i");
      filter.$or = [
        { title: search },
        { code: search },
        { instructor: search },
        { location: search },
      ];
    }
    if (input.status) filter.status = input.status;
    if (input.from || input.to) {
      filter.startsAt = {};
      if (input.from)
        filter.startsAt.$gte = new Date(input.from + "T00:00:00+05:30");
      if (input.to)
        filter.startsAt.$lt = new Date(
          new Date(input.to + "T00:00:00+05:30").getTime() + 86400000,
        );
    }
    if (input.available === "true") {
      if (input.status && input.status !== "SCHEDULED")
        return { data: [], total: 0, page: input.page, limit: input.limit };
      filter.status = "SCHEDULED";
      filter.$expr = { $lt: ["$activeCount", "$capacity"] };
      filter.startsAt = { ...filter.startsAt, $gt: new Date() };
    }
    const [data, total] = await Promise.all([
      this.db.models.Workshop.find(filter)
        .sort({ startsAt: 1, _id: 1 })
        .skip((input.page - 1) * input.limit)
        .limit(input.limit)
        .lean(),
      this.db.models.Workshop.countDocuments(filter),
    ]);
    return {
      data: data.map((row) => ({
        ...row,
        available: row.capacity - row.activeCount,
      })),
      total,
      page: input.page,
      limit: input.limit,
    };
  }

  async detail(id: string) {
    const workshop = await this.db.models.Workshop.findById(id).lean();
    if (!workshop) throw new NotFoundException("Workshop not found.");
    const [registrations, history, audit] = await Promise.all([
      this.db.models.Registration.find({ workshopId: id })
        .populate("registeredBy", "name")
        .populate("cancelledBy", "name")
        .sort({ registeredAt: -1, _id: -1 })
        .lean(),
      this.db.models.Event.find({ workshopId: id })
        .populate("actorId", "name")
        .populate("registrationId", "attendeeName attendeeEmail")
        .sort({ occurredAt: -1, _id: -1 })
        .lean(),
      this.db.models.Audit.find({ entityType: "WORKSHOP", entityId: id })
        .populate("actorId", "name")
        .sort({ occurredAt: -1 })
        .lean(),
    ]);
    return {
      workshop: {
        ...workshop,
        available: workshop.capacity - workshop.activeCount,
      },
      registrations,
      history,
      audit,
    };
  }

  async create(input: z.infer<typeof workshopSchema>, user: User) {
    if (
      input.status === "SCHEDULED" &&
      new Date(input.startsAt).getTime() <= Date.now()
    )
      throw new BadRequestException(
        "Scheduled workshops must start in the future.",
      );
    return this.db.transaction(async (session) => {
      const [workshop] = await this.db.models.Workshop.create(
        [
          {
            ...input,
            startsAt: new Date(input.startsAt),
            createdBy: user._id,
            updatedBy: user._id,
          },
        ],
        { session },
      );
      await this.db.models.Audit.create(
        [
          {
            actorId: user._id,
            action: "WORKSHOP_CREATED",
            entityType: "WORKSHOP",
            entityId: workshop._id,
            details: input,
          },
        ],
        { session },
      );
      return workshop;
    });
  }

  async update(
    id: string,
    input: z.infer<typeof updateWorkshopSchema>,
    user: User,
  ) {
    if (
      input.status === "SCHEDULED" &&
      new Date(input.startsAt).getTime() <= Date.now()
    )
      throw new BadRequestException(
        "Scheduled workshops must start in the future.",
      );
    const { expectedVersion, ...fields } = input;
    return this.db.transaction(async (session) => {
      const before = await this.db.models.Workshop.findById(id)
        .session(session)
        .lean();
      if (!before) throw new NotFoundException("Workshop not found.");
      if (before.version !== expectedVersion)
        throw new ConflictException(
          "This workshop changed. Refresh and edit the latest version.",
        );
      const updated = await this.db.models.Workshop.findOneAndUpdate(
        {
          _id: id,
          version: expectedVersion,
          activeCount: { $lte: input.capacity },
        },
        {
          $set: {
            ...fields,
            startsAt: new Date(input.startsAt),
            updatedBy: user._id,
          },
          $inc: { version: 1 },
        },
        { new: true, session, runValidators: true },
      );
      if (!updated)
        throw new ConflictException(
          "Capacity cannot be lower than the active registration count.",
        );
      await this.db.models.Audit.create(
        [
          {
            actorId: user._id,
            action: "WORKSHOP_UPDATED",
            entityType: "WORKSHOP",
            entityId: id,
            details: { before, after: fields },
          },
        ],
        { session },
      );
      return updated;
    });
  }

  async register(
    id: string,
    input: z.infer<typeof registrationSchema>,
    user: User,
  ) {
    return this.db.transaction(async (session) => {
      const previous = await this.db.models.Registration.findOne({
        requestId: input.requestId,
      })
        .session(session)
        .lean();
      if (previous) {
        if (
          String(previous.workshopId) !== id ||
          String(previous.registeredBy) !== String(user._id) ||
          previous.attendeeEmail !== input.attendeeEmail ||
          previous.attendeeName !== input.attendeeName
        )
          throw new ConflictException(
            "Request ID already used for another registration.",
          );
        return { registration: previous, replayed: true };
      }
      // One atomic conditional update claims a seat. No application-memory lock.
      const workshop = await this.db.models.Workshop.findOneAndUpdate(
        {
          _id: id,
          status: "SCHEDULED",
          startsAt: { $gt: new Date() },
          $expr: { $lt: ["$activeCount", "$capacity"] },
        },
        { $inc: { activeCount: 1, version: 1 } },
        { new: true, session },
      );
      if (!workshop) {
        const exists = await this.db.models.Workshop.findById(id)
          .session(session)
          .lean();
        if (!exists) throw new NotFoundException("Workshop not found.");
        throw new ConflictException(
          "This workshop is full, has started, or is not scheduled.",
        );
      }
      const [registration] = await this.db.models.Registration.create(
        [{ workshopId: id, ...input, registeredBy: user._id }],
        { session },
      );
      await this.db.models.Event.create(
        [
          {
            registrationId: registration._id,
            workshopId: id,
            event: "REGISTERED",
            actorId: user._id,
          },
        ],
        { session },
      );
      return { registration, replayed: false };
    });
  }

  async cancel(id: string, reason: string, user: User) {
    return this.db.transaction(async (session) => {
      const existing = await this.db.models.Registration.findById(id)
        .session(session)
        .lean();
      if (!existing) throw new NotFoundException("Registration not found.");
      if (existing.status === "CANCELLED") return existing;
      const registration = await this.db.models.Registration.findOneAndUpdate(
        { _id: id, status: "ACTIVE" },
        {
          $set: {
            status: "CANCELLED",
            cancelledBy: user._id,
            cancelledAt: new Date(),
            cancellationReason: reason,
          },
        },
        { new: true, session },
      );
      if (!registration)
        throw new ConflictException("Registration changed. Please try again.");
      const workshop = await this.db.models.Workshop.findOneAndUpdate(
        { _id: existing.workshopId, activeCount: { $gt: 0 } },
        { $inc: { activeCount: -1, version: 1 } },
        { new: true, session },
      );
      if (!workshop)
        throw new ConflictException(
          "Seat count is inconsistent. Please contact the manager.",
        );
      await this.db.models.Event.create(
        [
          {
            registrationId: id,
            workshopId: existing.workshopId,
            event: "CANCELLED",
            actorId: user._id,
            note: reason,
          },
        ],
        { session },
      );
      return registration;
    });
  }
}
