import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiErrorDto } from '@electro/shared';
import type { Response } from 'express';

/** Every error leaves the API in the same `ApiErrorDto` shape. Unexpected errors are logged, never leaked. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const dto: ApiErrorDto = {
        statusCode: status,
        error: HttpStatus[status] ?? 'Error',
        message: exception.message,
      };
      if (typeof body === 'object' && body !== null) {
        const b = body as { message?: unknown; fields?: Record<string, string> };
        if (typeof b.message === 'string') dto.message = b.message;
        else if (Array.isArray(b.message)) dto.message = b.message.join(' ');
        if (b.fields) dto.fields = b.fields;
      } else if (typeof body === 'string') {
        dto.message = body;
      }
      res.status(status).json(dto);
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    const dto: ApiErrorDto = {
      statusCode: 500,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong on the server. Your changes were not saved; please try again.',
    };
    res.status(500).json(dto);
  }
}
