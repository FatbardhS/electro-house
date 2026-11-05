import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Turns Zod issues into `{ "field.path": "message" }`, keeping the first message per field. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

/** Validates and transforms a request part with a shared Zod schema. Use: `@Body(new ZodPipe(schema))`. */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({ message: 'Some fields are invalid.', fields: zodFieldErrors(result.error) });
    }
    return result.data;
  }
}
