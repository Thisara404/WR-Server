import { createApplication } from "../src/bootstrap";
import type { INestApplication } from "@nestjs/common";

let app: INestApplication;

export default async function handler(req: any, res: any) {
  try {
    if (!app) {
      app = await createApplication();
      await app.init();
    }
    const expressInstance = app.getHttpAdapter().getInstance();
    expressInstance(req, res);
  } catch (err: any) {
    console.error("Vercel Serverless Function Error:", err);
    res.status(500).json({
      error: "Initialization error",
      message: err?.message || String(err),
    });
  }
}
