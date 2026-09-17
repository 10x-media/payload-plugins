import { translations } from './index'
import type { TranslationKey } from './keys'

const nestedOf = (locale: string) => translations[locale as keyof typeof translations]

/** Resolve a plugin string in `locale`, falling back to English. */
export const messageFor = (locale: null | string | undefined, key: TranslationKey): string => {
	const code = (locale ?? 'en').split('-')[0] ?? 'en'
	const separator = key.indexOf(':')
	const namespace = key.slice(0, separator)
	const rest = key.slice(separator + 1)
	return nestedOf(code)?.[namespace]?.[rest] ?? nestedOf('en')?.[namespace]?.[rest] ?? key
}
