import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Reflector } from "@nestjs/core";
import { RolesGuard, WriteGuard, type User } from "../src/security";
import {
  WorkshopsController,
  RegistrationsController,
} from "../src/workshops.controller";
import { UsersController } from "../src/users.controller";
import {
  registrationSchema,
  workshopSchema,
  updateWorkshopSchema,
  filterSchema,
  idSchema,
} from "../src/validation";
import { hashPassword, verifyPassword } from "../src/password";
const context = (controller: any, method: string, role: string) =>
  ({
    getHandler: () => controller.prototype[method],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  }) as any;
test("permission matrix: Admin only creates accounts; Manager edits workshops; Staff registers/cancels", () => {
  const guard = new RolesGuard(new Reflector());
  for (const [controller, method, allowed] of [
    [UsersController, "list", ["ADMIN"]],
    [UsersController, "create", ["ADMIN"]],
    [WorkshopsController, "list", ["MANAGER", "STAFF"]],
    [WorkshopsController, "detail", ["MANAGER", "STAFF"]],
    [WorkshopsController, "create", ["MANAGER"]],
    [WorkshopsController, "update", ["MANAGER"]],
    [WorkshopsController, "register", ["MANAGER", "STAFF"]],
    [RegistrationsController, "cancel", ["MANAGER", "STAFF"]],
  ] as const) {
    for (const role of ["ADMIN", "MANAGER", "STAFF"]) {
      if ((allowed as readonly string[]).includes(role))
        assert.equal(
          guard.canActivate(context(controller, method, role)),
          true,
        );
      else
        assert.throws(() =>
          guard.canActivate(context(controller, method, role)),
        );
    }
  }
});
test("write guard checks browser origin and JSON content type", () => {
  process.env.FRONTEND_URL = "http://localhost:5173";
  const guard = new WriteGuard();
  const make = (origin: string, validJson: boolean) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: "POST",
          headers: { origin },
          is: () => validJson,
        }),
      }),
    }) as any;
  assert.equal(guard.canActivate(make("http://localhost:5173", true)), true);
  assert.throws(() =>
    guard.canActivate(make("https://attacker.example", true)),
  );
  assert.throws(() => guard.canActivate(make("http://localhost:5173", false)));
});
test("input validation rejects invalid capacities, dates, IDs, and privileged client fields", () => {
  const valid = {
    code: "POT-1",
    title: "Pottery",
    instructor: "Teacher",
    location: "Kandy",
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    capacity: 20,
    status: "SCHEDULED",
  };
  assert.equal(workshopSchema.parse(valid).capacity, 20);
  for (const capacity of [0, -1, 1.5, 10001])
    assert.equal(
      workshopSchema.safeParse({ ...valid, capacity }).success,
      false,
    );
  assert.equal(
    workshopSchema.safeParse({ ...valid, activeCount: 0 }).success,
    false,
  );
  assert.equal(updateWorkshopSchema.safeParse(valid).success, false);
  assert.equal(
    registrationSchema.safeParse({
      attendeeName: "User",
      attendeeEmail: "user@example.com",
      requestId: "bad",
      registeredBy: "admin",
    }).success,
    false,
  );
  assert.equal(filterSchema.safeParse({ from: "2026-02-30" }).success, false);
  assert.equal(
    filterSchema.safeParse({ from: "2026-10-12", to: "2026-10-10" }).success,
    false,
  );
  assert.equal(idSchema.safeParse("not-an-id").success, false);
});
test("password hashes are salted and verify only the correct password", async () => {
  const first = await hashPassword("TestPassword123!");
  const second = await hashPassword("TestPassword123!");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("TestPassword123!", first), true);
  assert.equal(await verifyPassword("WrongPassword", first), false);
});
