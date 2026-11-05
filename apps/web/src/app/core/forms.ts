import { signal } from '@angular/core';
import type { z } from 'zod';
import { ApiError, toApiError } from './api-error';

/**
 * Submission state for a form validated by a shared Zod schema.
 * The same schema the API uses, so client and server agree on every rule.
 */
export class FormState<S extends z.ZodType> {
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly formError = signal<string | null>(null);
  readonly submitting = signal(false);

  constructor(private readonly schema: S) {}

  error(field: string): string | undefined {
    return this.fieldErrors()[field];
  }

  /** Validates `raw`, then runs `action` with the parsed value. Server field errors are shown on the form. */
  async submit(raw: unknown, action: (value: z.output<S>) => Promise<void>): Promise<boolean> {
    this.formError.set(null);
    const parsed = this.schema.safeParse(raw);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join('.')] ??= issue.message;
      this.fieldErrors.set(fields);
      return false;
    }
    this.fieldErrors.set({});
    this.submitting.set(true);
    try {
      await action(parsed.data);
      return true;
    } catch (err) {
      const e: ApiError = toApiError(err);
      this.fieldErrors.set(e.fields);
      this.formError.set(e.message);
      return false;
    } finally {
      this.submitting.set(false);
    }
  }
}
