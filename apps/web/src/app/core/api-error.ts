import { HttpErrorResponse } from '@angular/common/http';
import type { ApiErrorDto } from '@electro/shared';

/** A user-presentable error with optional field-level messages. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return new ApiError('Cannot reach the server. Check your connection and try again.', 0);
    }
    const body = err.error as Partial<ApiErrorDto> | null;
    if (body && typeof body.message === 'string') {
      return new ApiError(body.message, err.status, body.fields ?? {});
    }
    return new ApiError(`The server answered with an error (${err.status}).`, err.status);
  }
  if (err instanceof Error) return new ApiError(err.message, -1);
  return new ApiError('Unexpected error.', -1);
}

/** Message for a resource error signal (httpResource wraps HTTP errors). */
export function errorMessage(err: unknown): string {
  return toApiError(err).message;
}
