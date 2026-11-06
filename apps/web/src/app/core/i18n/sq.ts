import { SQ_CORE } from './sq-core';
import { SQ_PROJECTS } from './sq-projects';
import { SQ_EDITOR } from './sq-editor';
import { SQ_INSTALLATION } from './sq-installation';
import { SQ_SETTINGS } from './sq-settings';
import { SQ_EXTRA_MESSAGES } from './sq-messages';

/**
 * Albanian dictionary, keyed by the English text. Split by area so each file stays readable.
 * A text used with `| t` or `i18n.t()` must exist here, or the build fails.
 * Electrical terms are collected in sq-editor.ts / sq-installation.ts for easy review.
 */
export const SQ = {
  ...SQ_CORE,
  ...SQ_PROJECTS,
  ...SQ_EDITOR,
  ...SQ_INSTALLATION,
  ...SQ_SETTINGS,
} as const;

export type TKey = keyof typeof SQ;

/** Texts that arrive at runtime (server and validation messages); translated when they match exactly. */
export const SQ_EXTRA: Record<string, string> = SQ_EXTRA_MESSAGES;
