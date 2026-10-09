import { Module, Controller, Get, Inject } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { DatabaseService, WorkshopsService } from "./services";
import {
  AuthController,
  UsersController,
  WorkshopsController,
  RegistrationsController,
} from "./controllers";
import { Public, AuthGuard, RolesGuard, WriteGuard } from "./security";

@Controller()
class RootController {
  @Public()
  @Get()
  root() {
    return {
      status: "ok",
      service: "Workshop Registration Service API",
      health: "/api/health",
    };
  }
}

@Controller("health")
class HealthController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  @Public()
  @Get()
  async health() {
    await this.db.connection.db!.command({ ping: 1 });
    return { status: "ok" };
  }
}

@Module({
  controllers: [
    RootController,
    AuthController,
    UsersController,
    WorkshopsController,
    RegistrationsController,
    HealthController,
  ],
  providers: [
    DatabaseService,
    WorkshopsService,
    { provide: APP_GUARD, useClass: WriteGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
