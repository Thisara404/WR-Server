import {
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  UnsupportedMediaTypeException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import jwt from "jsonwebtoken";
import type { Request } from "express";
import { DatabaseService } from "../services/database.service";
import type { Role } from "../common/validation";

export type User = { _id: string; name: string; email: string; role: Role };
export type AuthRequest = Request & { user: User };
export const Public = () => SetMetadata("public", true);
export const Roles = (...roles: Role[]) => SetMetadata("roles", roles);
export const cookieName = "workshop_session";

export function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("replace-"))
    throw new Error("Set SESSION_SECRET to at least 32 random characters.");
  return secret;
}

export function signSession(id: string) {
  return jwt.sign({}, getSecret(), {
    subject: id,
    issuer: "workshop-service",
    audience: "workshop-web",
    expiresIn: "8h",
    algorithm: "HS256",
  });
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 8 * 60 * 60 * 1000,
  };
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>("public", [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const cookie = request.headers.cookie
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(cookieName + "="));

    if (!cookie) throw new UnauthorizedException("Please sign in.");

    let id: string;
    try {
      const token = jwt.verify(
        cookie.slice(cookieName.length + 1),
        getSecret(),
        {
          algorithms: ["HS256"],
          issuer: "workshop-service",
          audience: "workshop-web",
        },
      );
      if (
        typeof token === "string" ||
        !token.sub ||
        !String(token.sub).match(/^[0-9a-f]{24}$/i)
      )
        throw new Error("Invalid token");
      id = String(token.sub);
    } catch {
      throw new UnauthorizedException(
        "Your session expired. Please sign in again.",
      );
    }

    const user = await this.db.models.User.findById(id)
      .select("_id name email role")
      .lean();
    if (!user) throw new UnauthorizedException("Account no longer exists.");
    request.user = user as unknown as User;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<Role[]>("roles", [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles) return true;

    const request = context.switchToHttp().getRequest<AuthRequest>();
    if (!request.user || !roles.includes(request.user.role))
      throw new ForbiddenException("Your role cannot perform this action.");
    return true;
  }
}

@Injectable()
export class WriteGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;

    const configured = (process.env.FRONTEND_URL ?? "http://localhost:5173")
      .split(",")
      .map((value) => value.trim().replace(/\/$/, ""));
    const allowed = new Set(configured);
    for (const url of configured) {
      if (url.includes("localhost:5173")) allowed.add("http://127.0.0.1:5173");
      if (url.includes("127.0.0.1:5173")) allowed.add("http://localhost:5173");
    }

    const origin = request.headers.origin?.replace(/\/$/, "");
    if (origin && !allowed.has(origin) && !origin.endsWith(".vercel.app"))
      throw new ForbiddenException("Cross-origin requests are not allowed.");

    if (!request.is("application/json"))
      throw new UnsupportedMediaTypeException("Use application/json.");
    return true;
  }
}
