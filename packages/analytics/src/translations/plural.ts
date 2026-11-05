import { numberFormat, pluralRules } from './intl'
import {
	nestedString,
	type PluralCategory,
	type PluralName,
	type PluralVariant,
	pluralKeys,
} from './keys'
import { cutAtMark, MARK } from './parts'
import type { Translate } from './server'

/** What picking a plural form needs of Payload's `i18n`, on the server and in the browser alike. */
interface PluralI18n {
	language: string
	/** The request's strings as Payload nests them, `{ analytics: { name: value } }`. */
	translations: unknown
}

/** A `t` and the `i18n` it reads from, the pair Payload's `useTranslation` hands a component. */
interface PluralTranslation {
	t: Translate
	i18n: PluralI18n
}

/**
 * The CLDR category `n` takes in `language`. A language code `Intl` refuses (Payload's own
 * `zhTw`, say) reads in its BCP 47 tag, or as English, rather than throwing in a render.
 */
export const pluralCategory = (language: string, n: number): PluralCategory =>
	pluralRules(language).select(n)

/**
 * Key of `name`'s form for `n` in the request's language, falling back to `_other` where the
 * strings lack it. Not Payload's `t({ count })`, which sends every count above five to `_many`.
 */
export const pluralKey = (i18n: PluralI18n, name: PluralName, n: number): PluralVariant => {
	const forms = pluralKeys[name]
	const key = forms[pluralCategory(i18n.language, n)]
	return nestedString(i18n.translations, key) === undefined ? forms.other : key
}

const formatPluralCount = (language: string, n: number): string => numberFormat(language).format(n)

/** The phrase's other placeholders, such as the window a live count covers. */
type PluralVars = Readonly<Record<string, string>>

/** A counted phrase by its name, or its name and the other placeholders it fills. */
export type PluralPhrase = PluralName | { name: PluralName; vars: PluralVars }

const phraseOf = (phrase: PluralPhrase): { name: PluralName; vars: PluralVars } =>
	typeof phrase === 'string' ? { name: phrase, vars: {} } : phrase

/**
 * The phrase's form for `n`, its `{{count}}` the number as the language writes it. `count` is a
 * string so Payload's `t` leaves the form alone: it would look for a suffix of its own on a number.
 */
export const plural = ({ t, i18n }: PluralTranslation, phrase: PluralPhrase, n: number): string => {
	const { name, vars } = phraseOf(phrase)
	return t(pluralKey(i18n, name, n), { ...vars, count: formatPluralCount(i18n.language, n) })
}

/** A phrase cut where its count goes, so a surface can set the number apart from the words. */
interface PluralParts {
	before: string
	count: string
	after: string
}

/**
 * {@link plural}, cut at the count so realtime counters can draw the number large in the language's
 * own word order. A host string without `{{count}}` reads in full after the number.
 */
export const pluralParts = (
	{ t, i18n }: PluralTranslation,
	phrase: PluralPhrase,
	n: number
): PluralParts => {
	const { name, vars } = phraseOf(phrase)
	const count = formatPluralCount(i18n.language, n)
	const text = t(pluralKey(i18n, name, n), { ...vars, count: MARK })
	if (!text.includes(MARK)) {
		return { before: '', count, after: text }
	}
	const { before, after } = cutAtMark(text)
	return { before, count, after }
}
