import type { TranslationKey } from './keys'

/** A `t`-like function narrowed to this plugin's typed keys. */
type Translate = (key: TranslationKey) => string

/**
 * Adapt a Payload request `t` (typed to core keys only) so it also accepts this
 * plugin's keys. They are registered at config time and resolve at runtime; the
 * cast only widens the compile-time key domain.
 */
export const asTranslate = (t: unknown): Translate => t as Translate
