import { Controller, Get, Post, Body, Req, Inject } from "@nestjs/common";
import { DatabaseService } from "../services/database.service";
import { Roles, type AuthRequest } from "../security/security";
import { userSchema } from "../common/validation";
import { hashPassword } from "../security/password";

@Controller("users")
@Roles("ADMIN")
export class UsersController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  @Get()
  async list() {
    return {
      data: await this.db.models.User.find()
        .select("_id name email role createdAt")
        .sort({ createdAt: -1 })
        .lean(),
    };
  }

  @Get("history")
  async history() {
    return {
      data: await this.db.models.Audit.find({ entityType: "USER" })
        .populate("actorId", "name")
        .sort({ occurredAt: -1 })
        .limit(100)
        .lean(),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: AuthRequest) {
    const input = userSchema.parse(body);
    const passwordHash = await hashPassword(input.password);
    return this.db.transaction(async (session) => {
      const [created] = await this.db.models.User.create(
        [
          {
            name: input.name,
            email: input.email,
            passwordHash,
            role: input.role,
            createdBy: request.user._id,
          },
        ],
        { session },
      );
      await this.db.models.Audit.create(
        [
          {
            actorId: request.user._id,
            action: "ACCOUNT_CREATED",
            entityType: "USER",
            entityId: created._id,
            details: { name: input.name, email: input.email, role: input.role },
          },
        ],
        { session },
      );
      return {
        _id: String(created._id),
        name: created.name,
        email: created.email,
        role: created.role,
        createdAt: created.createdAt,
      };
    });
  }
}
