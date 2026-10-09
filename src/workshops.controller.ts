import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Req,
  Res,
  Inject,
  HttpCode,
} from "@nestjs/common";
import type { Response } from "express";
import { Roles, type AuthRequest } from "./security";
import { WorkshopsService } from "./workshops.service";
import {
  filterSchema,
  idSchema,
  workshopSchema,
  updateWorkshopSchema,
  registrationSchema,
  cancellationSchema,
} from "./validation";
@Controller("workshops")
@Roles("MANAGER", "STAFF")
export class WorkshopsController {
  constructor(
    @Inject(WorkshopsService) private readonly service: WorkshopsService,
  ) {}
  @Get() list(@Query() query: unknown) {
    return this.service.list(filterSchema.parse(query));
  }
  @Get(":id") detail(@Param("id") id: string) {
    return this.service.detail(idSchema.parse(id));
  }
  @Roles("MANAGER") @Post() create(
    @Body() body: unknown,
    @Req() request: AuthRequest,
  ) {
    return this.service.create(workshopSchema.parse(body), request.user);
  }
  @Roles("MANAGER") @Patch(":id") update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
  ) {
    return this.service.update(
      idSchema.parse(id),
      updateWorkshopSchema.parse(body),
      request.user,
    );
  }
  @Post(":id/registrations") async register(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.service.register(
      idSchema.parse(id),
      registrationSchema.parse(body),
      request.user,
    );
    response.status(result.replayed ? 200 : 201);
    return result;
  }
}
@Controller("registrations")
@Roles("MANAGER", "STAFF")
export class RegistrationsController {
  constructor(
    @Inject(WorkshopsService) private readonly service: WorkshopsService,
  ) {}
  @Post(":id/cancel") @HttpCode(200) cancel(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
  ) {
    return this.service.cancel(
      idSchema.parse(id),
      cancellationSchema.parse(body).reason,
      request.user,
    );
  }
}
