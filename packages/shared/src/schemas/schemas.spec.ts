import { describe, expect, it } from 'vitest';
import { clientInputSchema, floorSettingsSchema, projectCreateSchema, signUpSchema } from './schemas.js';

describe('input validation', () => {
  it('normalizes client input and turns blanks into null', () => {
    const parsed = clientInputSchema.parse({ name: '  Hoxha Family ', email: '', phone: ' ', notes: undefined });
    expect(parsed).toEqual({ name: 'Hoxha Family', email: null, phone: null, notes: undefined });
  });

  it('rejects a client without a name and a malformed email', () => {
    const r = clientInputSchema.safeParse({ name: '   ', email: 'not-an-email' });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['name', 'email']));
  });

  it('requires a valid client id and defaults status for new projects', () => {
    expect(projectCreateSchema.safeParse({ clientId: 'abc', name: 'House' }).success).toBe(false);
    const ok = projectCreateSchema.parse({ clientId: '0b8a3f1e-1f7a-4c41-9a3e-6b0f2a0c8d11', name: 'House' });
    expect(ok.status).toBe('PLANNING');
  });

  it('enforces password length and lowercases email on sign up', () => {
    expect(
      signUpSchema.safeParse({ name: 'A', email: 'a@b.co', password: 'short', organizationName: 'X' }).success,
    ).toBe(false);
    const ok = signUpSchema.parse({
      name: 'A',
      email: 'Electrician@Example.COM',
      password: 'long-enough-pw',
      organizationName: 'Spark Ltd',
    });
    expect(ok.email).toBe('electrician@example.com');
  });

  it('only accepts quarter-turn rotations and requires a base revision for floor settings', () => {
    expect(floorSettingsSchema.safeParse({ baseRevision: 0, planRotation: 45 }).success).toBe(false);
    expect(floorSettingsSchema.safeParse({ planRotation: 90 }).success).toBe(false);
    expect(floorSettingsSchema.safeParse({ baseRevision: 3, planRotation: 270 }).success).toBe(true);
  });

  it('rejects calibration with a non-positive scale', () => {
    const r = floorSettingsSchema.safeParse({
      baseRevision: 0,
      calibration: { method: 'paper-scale', paperScale: 0, metresPerUnit: 1, calibratedAt: new Date().toISOString() },
    });
    expect(r.success).toBe(false);
  });
});
