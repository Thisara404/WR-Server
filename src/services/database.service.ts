import {
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  createConnection,
  type Connection,
  type ClientSession,
} from "mongoose";
import { createModels, type Models } from "../models/models";

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  connection!: Connection;
  models!: Models;

  async onModuleInit() {
    const uri = process.env.MONGODB_URI;
    if (!uri || uri.includes("YOUR_"))
      throw new Error(
        "Set MONGODB_URI to your MongoDB Atlas connection string.",
      );
    this.connection = await createConnection(uri, {
      maxPoolSize: 5,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 10000,
      autoIndex: false,
    }).asPromise();
    this.models = createModels(this.connection);
  }

  async transaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      return (await session.withTransaction(() => work(session), {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      })) as T;
    } finally {
      await session.endSession();
    }
  }

  async onModuleDestroy() {
    await this.connection?.close();
  }
}
