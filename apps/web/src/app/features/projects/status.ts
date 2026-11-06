import type { ProjectStatus } from '@electro/shared';
import type { TKey } from '../../core/i18n/sq';

export const STATUS_LABELS: Record<ProjectStatus, TKey> = {
  PLANNING: 'Planning',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};
