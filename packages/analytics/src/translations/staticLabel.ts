import { isRecord } from '../core/values'
import { ar } from './ar'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { id } from './id'
import type { TranslationsOption } from './index'
import { nestedString, type SingularKey } from './keys'
import { ko } from './ko'
import { pt } from './pt'
import { ru } from './ru'
import { uk } from './uk'
import { zh } from './zh'

/** English first: Payload reads a map's first entry when neither language nor fallback is in it. */
const BUNDLES: Record<string, Record<SingularKey, string>> = {
	en,
	ar,
	de,
	es,
	fr,
	id,
	ko,
	pt,
	ru,
	uk,
	zh,
}

/** Where an install's own strings come from, each winning over the next. */
interface StaticLabelSources {
	/** `config.i18n.translations` as the plugin found it, nested `{ locale: { analytics: { name } } }`. */
	app?: unknown
	/** The plugin's `translations` option, flat `{ locale: { 'analytics:name': value } }`. */
	plugin?: TranslationsOption
	/** Admin languages the plugin ships no strings for, which read the English ones. */
	unbundled?: readonly string[]
}

/** A key as the locale map Payload resolves where no request, and so no `t`, is at hand. */
export type StaticLabelFor = (key: SingularKey) => Record<string, string>

/**
 * Per-locale labels where a label function never runs (`admin.group`, select options, UI labels),
 * in Payload's merge order: app `i18n.translations`, plugin `translations`, built-ins.
 */
export const createStaticLabels = (sources: StaticLabelSources = {}): StaticLabelFor => {
	const made = new Map<SingularKey, Record<string, string>>()
	return (key) => {
		const hit = made.get(key)
		if (hit) {
			return hit
		}
		const label: Record<string, string> = {}
		for (const [locale, bundle] of Object.entries(BUNDLES)) {
			label[locale] = bundle[key]
		}
		for (const locale of sources.unbundled ?? []) {
			label[locale] ??= en[key]
		}
		for (const [locale, flat] of Object.entries(sources.plugin ?? {})) {
			const value = flat[key]
			if (typeof value === 'string') {
				label[locale] = value
			}
		}
		for (const [locale, nested] of Object.entries(isRecord(sources.app) ? sources.app : {})) {
			const value = nestedString(nested, key)
			if (value !== undefined) {
				label[locale] = value
			}
		}
		made.set(key, label)
		return label
	}
}

const builtIn = createStaticLabels()
const builtInKeys = new WeakMap<object, SingularKey>()

/**
 * Built-in strings alone, for field factories a host calls before the plugin sees the install's
 * options; the plugin relabels them later (`relabelFactoryFields`).
 */
export const builtInStaticLabel: StaticLabelFor = (key) => {
	const label = builtIn(key)
	builtInKeys.set(label, key)
	return label
}

/** The key a {@link builtInStaticLabel} map was made for; undefined for any other value. */
export const builtInLabelKey = (value: unknown): SingularKey | undefined =>
	typeof value === 'object' && value !== null ? builtInKeys.get(value) : undefined
