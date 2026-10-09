import "dotenv/config";
import { createConnection } from "mongoose";
import { createModels } from "../src/models";
import { hashPassword } from "../src/security/password";
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes("YOUR_"))
    throw new Error("Set MONGODB_URI in backend/.env.");
  const db = await createConnection(uri, { autoIndex: false }).asPromise();
  const models = createModels(db);
  try {
    // Create collections and unique indexes before starting transactional writes.
    for (const model of Object.values(models)) {
      await model.createCollection();
      await model.createIndexes();
    }
    const passwords = [
      process.env.SEED_ADMIN_PASSWORD,
      process.env.SEED_MANAGER_PASSWORD,
      process.env.SEED_STAFF_PASSWORD,
    ];
    if (passwords.some((value) => !value || value.length < 10))
      throw new Error(
        "Set all three SEED_*_PASSWORD values to at least 10 characters.",
      );
    const hashes = [];
    for (const password of passwords)
      hashes.push(await hashPassword(password!));
    const admin = await models.User.findOneAndUpdate(
      { email: "admin@workshop.local" },
      {
        $setOnInsert: {
          name: "Centre Admin",
          role: "ADMIN",
          passwordHash: hashes[0],
        },
      },
      { new: true, upsert: true },
    );
    const manager = await models.User.findOneAndUpdate(
      { email: "manager@workshop.local" },
      {
        $setOnInsert: {
          name: "Programme Manager",
          role: "MANAGER",
          passwordHash: hashes[1],
          createdBy: admin._id,
        },
      },
      { new: true, upsert: true },
    );
    await models.User.updateOne(
      { email: "staff@workshop.local" },
      {
        $setOnInsert: {
          name: "Front Desk Staff",
          role: "STAFF",
          passwordHash: hashes[2],
          createdBy: admin._id,
        },
      },
      { upsert: true },
    );
    for (const [days, code, title, instructor, location, capacity] of [
      [
        2,
        "POT-101",
        "Introduction to Pottery",
        "Amaya Silva",
        "Kandy Centre",
        12,
      ],
      [
        3,
        "WEB-201",
        "Build Your First Website",
        "Nimal Perera",
        "Colombo Centre",
        20,
      ],
      [5, "FIT-101", "Morning Mobility", "Ravi Fernando", "Galle Centre", 8],
      [
        7,
        "ART-101",
        "Watercolour Basics",
        "Ishani Jayasuriya",
        "Kandy Centre",
        15,
      ],
    ]) {
      const date = new Date(Date.now() + Number(days) * 86400000);
      date.setUTCHours(4, 30, 0, 0);
      await models.Workshop.updateOne(
        { code },
        {
          $setOnInsert: {
            title,
            instructor,
            location,
            capacity,
            startsAt: date,
            status: "SCHEDULED",
            activeCount: 0,
            version: 1,
            createdBy: manager._id,
            updatedBy: manager._id,
          },
        },
        { upsert: true },
      );
    }
    console.log(
      "Seed complete: Admin, Admin-provisioned Manager/Staff demo accounts, and four sample workshops. Existing passwords are retained.",
    );
  } finally {
    await db.close();
  }
}
void main();
