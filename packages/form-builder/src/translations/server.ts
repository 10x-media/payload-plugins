import type { LabelFunction } from 'payload'

import type { Translate as FieldTranslate } from '../fields/types'
import type { TranslationKey } from './keys'

/** A `t`-like function narrowed to this plugin's typed keys. */
type Translate = (key: TranslationKey) => string

/**
 * Adapt a Payload request `t` (typed to core keys only) so it also accepts this
 * plugin's keys. They are registered at config time and resolve at runtime; the
 * cast only widens the compile-time key domain.
 */
export const asTranslate = (t: unknown): Translate => t as Translate

/**
 * Adapt a Payload request `t` to the engine-facing `Translate` the submission core and field-type
 * `format`/`validate` speak (any key string). Same runtime function as `asTranslate`; this widening
 * accepts arbitrary keys because the engine resolves both this plugin's and a host's registered keys.
 */
export const asFieldTranslate = (t: unknown): FieldTranslate => t as FieldTranslate

/** A field `label`/`description` backed by a typed key, resolved per request. */
export const labelForKey =
	(key: TranslationKey): LabelFunction =>
	({ t }) =>
		asTranslate(t)(key)

/**
 * A `label`/`description` from an arbitrary key string (a field-type-supplied label, which may be a
 * host-registered key or a literal; Payload's `t` returns the input unchanged when unknown). Distinct
 * from `labelForKey`, which constrains to this plugin's typed keys.
 */
export const labelFor =
	(key: string): LabelFunction =>
	({ t }) =>
		asTranslate(t)(key as TranslationKey)

/**
 * Turn a registry definition's `label` into a value Payload accepts for a field/block `label`. A
 * string resolves per request like a field label (an i18n key or a literal) via `labelFor`; a
 * per-locale record passes through unchanged. Shared by the action, poll-source, and poll-type
 * registries so every definition label honors one contract.
 */
export const resolveDefinitionLabel = (
	label: string | Record<string, string>
): LabelFunction | Record<string, string> => (typeof label === 'string' ? labelFor(label) : label)
