import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { ZodError } from "zod";
import type { Response } from "express";

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (error instanceof ZodError) {
      response
        .status(400)
        .json({ message: "Check the submitted fields.", issues: error.issues });
      return;
    }

    if (error instanceof HttpException) {
      const body = error.getResponse();
      response
        .status(error.getStatus())
        .json(typeof body === "string" ? { message: body } : body);
      return;
    }

    const known = error as {
      code?: number;
      type?: string;
      status?: number;
      message?: string;
    };

    if (known?.code === 11000) {
      response
        .status(409)
        .json({
          message:
            "This email, workshop code, or active attendee registration already exists.",
        });
      return;
    }

    if (known?.type === "entity.too.large") {
      response.status(413).json({ message: "Request too large." });
      return;
    }

    if (known?.type === "entity.parse.failed") {
      response.status(400).json({ message: "Invalid JSON body." });
      return;
    }

    console.error(error);
    response
      .status(500)
      .json({
        message: "An unexpected server error occurred. Please try again.",
      });
  }
}
