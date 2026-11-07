import { SetMetadata } from '@nestjs/common';
import type { ActivityAction } from '@electro/shared';
import type { Request } from 'express';
import type { TargetType } from './activity.service.js';

export interface TrackOptions {
  /** What the action is about. With `param`, the id comes from that route parameter and the name is read
   *  before the handler runs (so it is known even after a delete). Without it, `id`/`name` come from the result. */
  target?: { type: TargetType; param?: string };
  /** Target id/name taken from the handler's result (overrides the defaults `result.id` / `result.name`). */
  fromResult?: (result: unknown) => { id?: string | null; name?: string | null };
  /** Extra facts to keep (never passwords or tokens). */
  details?: (req: Request) => Record<string, unknown>;
}

export interface TrackMeta extends TrackOptions {
  action: ActivityAction;
}

export const TRACK_ACTIVITY_KEY = 'trackActivity';

/** Records this route in the activity log after it succeeds (see ActivityInterceptor). */
export const TrackActivity = (action: ActivityAction, options: TrackOptions = {}) =>
  SetMetadata(TRACK_ACTIVITY_KEY, { action, ...options } satisfies TrackMeta);
