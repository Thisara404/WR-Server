import { createApplication } from "../src/bootstrap";
import type { INestApplication } from "@nestjs/common";

let app: INestApplication;

export default async function handler(req: any, res: any) {
  if (!app) {
    app = await createApplication();
    await app.init();
  }
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance(req, res);
}
