import type { LabelFunction } from 'payload'

import type { TranslationKey } from './keys'

/**
 * A `t`-like function narrowed to this plugin's typed keys. `vars` fills a key's
 * `{{placeholders}}`, which Payload's own `t` substitutes in one pass.
 */
export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string

/**
 * Widens a Payload request `t` (typed to core keys) to this plugin's keys, which are registered at
 * config time; the cast only changes the compile-time key domain.
 */
export const asTranslate = (t: unknown): Translate => t as Translate

/** A field `label`/`description` backed by a typed key, resolved per request. */
export const labelForKey =
	(key: TranslationKey): LabelFunction =>
	({ t }) =>
		asTranslate(t)(key)
