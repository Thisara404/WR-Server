import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  Inject,
  UnauthorizedException,
  HttpCode,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Response } from "express";
import { DatabaseService } from "../services/database.service";
import {
  Public,
  cookieName,
  cookieOptions,
  signSession,
  type AuthRequest,
} from "../security/security";
import { loginSchema } from "../common/validation";
import { verifyPassword } from "../security/password";

@Controller("auth")
export class AuthController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = loginSchema.parse(body);
    const key = createHash("sha256").update(input.email).digest("hex");
    await this.db.models.LoginLimit.updateOne(
      { _id: key, windowStart: { $lt: new Date(Date.now() - 900000) } },
      { $set: { windowStart: new Date(), attempts: 0 } },
    );
    const limit = await this.db.models.LoginLimit.findOneAndUpdate(
      { _id: key },
      { $inc: { attempts: 1 }, $setOnInsert: { windowStart: new Date() } },
      { new: true, upsert: true },
    ).lean();
    if (limit.attempts > 30)
      throw new HttpException(
        "Too many login attempts. Try again in 15 minutes.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const user = await this.db.models.User.findOne({
      email: input.email,
    }).lean();
    if (!user || !(await verifyPassword(input.password, user.passwordHash)))
      throw new UnauthorizedException("Incorrect email or password.");
    response.cookie(cookieName, signSession(String(user._id)), cookieOptions());
    return {
      user: {
        _id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  @Get("me") me(@Req() request: AuthRequest) {
    return { user: request.user };
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(cookieName, { ...cookieOptions(), maxAge: undefined });
    return { ok: true };
  }
}
