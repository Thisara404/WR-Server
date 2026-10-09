import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import express from "express";
import { AppModule } from "./app.module";
import { HttpErrorFilter } from "./http-error.filter";
import { getSecret } from "./security";
export async function createApplication() {
  getSecret();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.setGlobalPrefix("api");
  app.use(express.json({ limit: "32kb" }));
  app.use(
    (
      _req: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-Frame-Options", "DENY");
      next();
    },
  );
  const configuredOrigins = (process.env.FRONTEND_URL ?? "http://localhost:5173")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""));
  const allowedOrigins = new Set(configuredOrigins);
  for (const url of configuredOrigins) {
    if (url.includes("localhost:5173")) allowedOrigins.add("http://127.0.0.1:5173");
    if (url.includes("127.0.0.1:5173")) allowedOrigins.add("http://localhost:5173");
  }
  app.enableCors({
    origin: Array.from(allowedOrigins),
    credentials: true,
  });
  app.useGlobalFilters(new HttpErrorFilter());
  return app;
}
