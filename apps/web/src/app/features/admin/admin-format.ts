import { ACTIVITY_ACTIONS, WARNING_ACTIONS, type ActivityAction } from '@electro/shared';
import { t, tx } from '../../core/i18n/i18n.service';

/** "just now", "5 min ago", "3 h ago", "4 days ago" (in the UI language); older than 30 days → the date. */
export function timeAgo(value: string | null, dateText: (v: string) => string): string {
  if (!value) return t('Never');
  const s = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86_400) return t('{n} h ago', { n: Math.floor(s / 3600) });
  if (s < 30 * 86_400) return t('{n} days ago', { n: Math.floor(s / 86_400) });
  return dateText(value);
}

export function actionLabel(action: string): string {
  const label = (ACTIVITY_ACTIONS as Record<string, string>)[action];
  return label ? tx(label) : action;
}

export function isWarning(action: string): boolean {
  return WARNING_ACTIONS.includes(action as ActivityAction);
}

/** Group of an action, for its colour: auth, team, work, export, warning. */
export function actionKind(action: string): string {
  if (isWarning(action)) return 'warn';
  const group = action.split('.')[0];
  if (group === 'auth' || group === 'invitation') return 'auth';
  if (group === 'team') return 'team';
  if (group === 'export') return 'export';
  return 'work';
}

/** "Chrome · Windows" from a user agent string (good enough to recognise devices). */
export function deviceOf(ua: string | null): string {
  if (!ua) return '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : '';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return [browser, os].filter(Boolean).join(' · ') || ua.slice(0, 40);
}

export const SUBSCRIPTION_LABELS: Record<string, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment overdue',
  canceled: 'Canceled',
  expired: 'Expired',
};
