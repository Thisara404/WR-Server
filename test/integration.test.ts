import "reflect-metadata";
import "dotenv/config";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createConnection, type Connection, Types } from "mongoose";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import express from "express";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/services";
import { createModels, type Models } from "../src/models";
import { HttpErrorFilter } from "../src/common";
import { hashPassword } from "../src/security/password";
import { signSession, cookieName } from "../src/security";

// Uses its own randomly named database. Only that test database is dropped.
let connection: Connection;
let models: Models;
let app: INestApplication;
let db: DatabaseService;
let managerId: string;
let staffId: string;
let adminId: string;
let workshopId: string;
let adminCookie: string;
let managerCookie: string;
let staffCookie: string;
const databaseName = "wt_" + randomUUID().replaceAll("-", "").slice(0, 20);
before(async () => {
  if (!process.env.MONGODB_URI)
    throw new Error(
      "Set MONGODB_URI to a replica-set URI before running integration tests.",
    );
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET ??
    "integration-test-secret-at-least-32-characters";
  process.env.FRONTEND_URL = "http://localhost:5173";
  connection = await createConnection(process.env.MONGODB_URI, {
    dbName: databaseName,
    autoIndex: false,
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20,
  }).asPromise();
  models = createModels(connection);
  for (const model of Object.values(models)) {
    await model.createCollection();
    await model.createIndexes();
  }
  db = new DatabaseService();
  db.connection = connection;
  db.models = models;
  // Keep Nest startup from creating a second connection; this is the test fixture.
  db.onModuleInit = async () => {};
  db.onModuleDestroy = async () => {};
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue(db)
    .compile();
  app = module.createNestApplication({ bodyParser: false });
  app.setGlobalPrefix("api");
  app.use(express.json());
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
});
beforeEach(async () => {
  for (const model of Object.values(models)) await model.deleteMany({});
  const passwordHash = await hashPassword("Integration123!");
  const users = await models.User.create([
    { name: "Admin", email: "admin@test.local", passwordHash, role: "ADMIN" },
    {
      name: "Manager",
      email: "manager@test.local",
      passwordHash,
      role: "MANAGER",
    },
    { name: "Staff", email: "staff@test.local", passwordHash, role: "STAFF" },
  ]);
  [adminId, managerId, staffId] = users.map((user: { _id: unknown }) =>
    String(user._id),
  );
  adminCookie = cookieName + "=" + signSession(adminId);
  managerCookie = cookieName + "=" + signSession(managerId);
  staffCookie = cookieName + "=" + signSession(staffId);
  const workshop = await models.Workshop.create({
    code: "TEST-1",
    title: "Test Workshop",
    instructor: "Teacher",
    location: "Kandy Centre",
    startsAt: new Date(Date.now() + 86400000),
    capacity: 2,
    createdBy: managerId,
    updatedBy: managerId,
  });
  workshopId = String(workshop._id);
});
after(async () => {
  if (app) await app.close();
  if (connection) {
    await connection.dropDatabase();
    await connection.close();
  }
});
const payload = (email = "attendee@example.com") => ({
  attendeeName: "Test Attendee",
  attendeeEmail: email,
  requestId: randomUUID(),
});
const register = (body = payload()) =>
  request(app.getHttpServer())
    .post(`/api/workshops/${workshopId}/registrations`)
    .set("Cookie", staffCookie)
    .send(body);

test("login uses HttpOnly cookies, rejects incorrect credentials, and exposes no password hash", async () => {
  await request(app.getHttpServer())
    .post("/api/auth/login")
    .send({ email: "staff@test.local", password: "wrong" })
    .expect(401);
  const response = await request(app.getHttpServer())
    .post("/api/auth/login")
    .send({ email: "staff@test.local", password: "Integration123!" })
    .expect(200);
  assert.ok(String(response.headers["set-cookie"]).includes("HttpOnly"));
  assert.equal(response.body.user.passwordHash, undefined);
});
test("the backend refuses every role action excluded by the assignment", async () => {
  await request(app.getHttpServer())
    .get("/api/workshops")
    .set("Cookie", adminCookie)
    .expect(403);
  await register().set("Cookie", adminCookie).expect(403);
  await request(app.getHttpServer())
    .get("/api/users")
    .set("Cookie", staffCookie)
    .expect(403);
  await request(app.getHttpServer())
    .post("/api/users")
    .set("Cookie", managerCookie)
    .send({})
    .expect(403);
  await request(app.getHttpServer())
    .post("/api/workshops")
    .set("Cookie", staffCookie)
    .send({})
    .expect(403);
  await request(app.getHttpServer()).get("/api/workshops").expect(401);
});
test("admin creates a staff account and managers create workshops", async () => {
  await request(app.getHttpServer())
    .post("/api/users")
    .set("Cookie", adminCookie)
    .send({
      name: "New Staff",
      email: "new@test.local",
      password: "SecurePassword123!",
      role: "STAFF",
    })
    .expect(201);
  const response = await request(app.getHttpServer())
    .post("/api/workshops")
    .set("Cookie", managerCookie)
    .send({
      code: "NEW-1",
      title: "New Workshop",
      instructor: "Teacher",
      location: "Colombo Centre",
      startsAt: new Date(Date.now() + 172800000).toISOString(),
      capacity: 10,
      status: "SCHEDULED",
    })
    .expect(201);
  assert.equal(response.body.activeCount, 0);
  assert.equal(await models.Audit.countDocuments(), 2);
});
test("registration records who/when, retries once, and preserves one active attendee per email", async () => {
  const body = payload();
  const created = await register(body).expect(201);
  const retry = await register(body).expect(200);
  assert.equal(created.body.registration._id, retry.body.registration._id);
  assert.equal(retry.body.replayed, true);
  assert.equal(await models.Event.countDocuments({ event: "REGISTERED" }), 1);
  assert.equal((await models.Workshop.findById(workshopId))!.activeCount, 1);
  await register({ ...body, requestId: randomUUID() }).expect(409);
  assert.equal((await models.Workshop.findById(workshopId))!.activeCount, 1);
});
test("TWENTY concurrent registrations for TWO seats create exactly two active records", async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      register(payload(`person${index}@example.com`)),
    ),
  );
  assert.equal(results.filter((result) => result.status === 201).length, 2);
  assert.equal(results.filter((result) => result.status === 409).length, 18);
  assert.equal(
    await models.Registration.countDocuments({ status: "ACTIVE" }),
    2,
  );
  assert.equal((await models.Workshop.findById(workshopId))!.activeCount, 2);
  assert.equal(await models.Event.countDocuments({ event: "REGISTERED" }), 2);
});
test("cancellation restores one seat and records actor/time exactly once under concurrent requests", async () => {
  const created = await register().expect(201);
  const id = created.body.registration._id;
  const cancel = () =>
    request(app.getHttpServer())
      .post(`/api/registrations/${id}/cancel`)
      .set("Cookie", managerCookie)
      .send({ reason: "Attendee cannot attend" });
  const results = await Promise.all([cancel(), cancel(), cancel()]);
  assert.ok(results.every((result) => result.status === 200));
  const record = await models.Registration.findById(id);
  assert.equal(record!.status, "CANCELLED");
  assert.equal(String(record!.cancelledBy), managerId);
  assert.ok(record!.cancelledAt);
  assert.equal((await models.Workshop.findById(workshopId))!.activeCount, 0);
  assert.equal(await models.Event.countDocuments({ event: "CANCELLED" }), 1);
  await register(payload()).expect(201);
  assert.equal(await models.Registration.countDocuments(), 2);
});
test("workshop edit cannot lower capacity below bookings or overwrite a stale version", async () => {
  await register(payload("one@example.com")).expect(201);
  await register(payload("two@example.com")).expect(201);
  const current = (await models.Workshop.findById(workshopId))!;
  const body = {
    code: current.code,
    title: current.title,
    instructor: current.instructor,
    location: current.location,
    startsAt: current.startsAt.toISOString(),
    capacity: 1,
    status: "SCHEDULED",
    expectedVersion: current.version,
  };
  await request(app.getHttpServer())
    .patch(`/api/workshops/${workshopId}`)
    .set("Cookie", managerCookie)
    .send(body)
    .expect(409);
  await request(app.getHttpServer())
    .patch(`/api/workshops/${workshopId}`)
    .set("Cookie", managerCookie)
    .send({ ...body, capacity: 3, expectedVersion: 1 })
    .expect(409);
  await request(app.getHttpServer())
    .patch(`/api/workshops/${workshopId}`)
    .set("Cookie", managerCookie)
    .send({ ...body, capacity: 3 })
    .expect(200);
});
test("history includes cancelled records and date/status/availability filters work", async () => {
  const created = await register().expect(201);
  await request(app.getHttpServer())
    .post(`/api/registrations/${created.body.registration._id}/cancel`)
    .set("Cookie", staffCookie)
    .send({})
    .expect(200);
  const detail = await request(app.getHttpServer())
    .get(`/api/workshops/${workshopId}`)
    .set("Cookie", staffCookie)
    .expect(200);
  assert.equal(detail.body.registrations.length, 1);
  assert.equal(detail.body.history.length, 2);
  assert.equal(detail.body.workshop.available, 2);
  const list = await request(app.getHttpServer())
    .get("/api/workshops?available=true&status=SCHEDULED")
    .set("Cookie", staffCookie)
    .expect(200);
  assert.equal(list.body.total, 1);
  const past = await request(app.getHttpServer())
    .get("/api/workshops?to=2000-01-01")
    .set("Cookie", staffCookie)
    .expect(200);
  assert.equal(past.body.total, 0);
});
test("an event-write failure rolls back the seat claim and registration", async () => {
  const original = models.Event.create;
  models.Event.create = async () => {
    throw new Error("Injected event persistence failure");
  };
  try {
    await register().expect(500);
  } finally {
    models.Event.create = original;
  }
  assert.equal((await models.Workshop.findById(workshopId))!.activeCount, 0);
  assert.equal(await models.Registration.countDocuments(), 0);
});
