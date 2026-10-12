import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { analytics } from '../index'
import { memoryAdapter } from '../testing/memoryAdapter'
import { keys, type TranslationKey } from '../translations/keys'
import { createStaticLabels } from '../translations/staticLabel'
import { unbundledLanguages } from './unbundledLanguages'

type Nested = Record<string, Record<string, Record<string, string>>>

/** Payload's language objects; only their keys matter to the plugin. */
const supporting = (...languages: string[]): Config['i18n'] =>
	({
		supportedLanguages: Object.fromEntries(languages.map((language) => [language, {}])),
	}) as Config['i18n']

/**
 * What `t` answers for a language: Payload merges `config.i18n.translations[language]` over its
 * own strings and falls back to the key itself (translations/src/utilities/init.ts).
 */
const translate = (config: Config, language: string, key: TranslationKey): string => {
	const [namespace = '', name = ''] = key.split(':')
	const strings = (config.i18n?.translations as Nested | undefined)?.[language]
	return strings?.[namespace]?.[name] ?? key
}

const configured = async (i18n: Config['i18n'], options = {}): Promise<Config> =>
	(await analytics({ adapters: [memoryAdapter()], ...options })({
		collections: [],
		i18n,
	} as unknown as Config)) as Config

describe('unbundledLanguages', () => {
	it('lists the supported languages the plugin ships no strings for', () => {
		expect(unbundledLanguages({ i18n: supporting('en', 'ja', 'de', 'nl') } as Config)).toEqual([
			'ja',
			'nl',
		])
	})

	// Payload supports English alone when `supportedLanguages` is unset (config/sanitize.ts).
	it('lists nothing when the config leaves the languages to Payload', () => {
		expect(unbundledLanguages({} as Config)).toEqual([])
	})
})

describe('admin languages without a bundle', () => {
	it('read the English strings rather than raw keys', async () => {
		const out = await configured(supporting('en', 'ja', 'nl'))
		expect(translate(out, 'ja', keys.viewTitle)).toBe('Analytics')
		expect(translate(out, 'nl', keys.viewTitle)).toBe('Analytics')
		expect(translate(out, 'nl', keys.timeframeLastYear)).toBe('Last 12 months')
	})

	it('keep every string the host set for the language, key by key', async () => {
		const out = await configured({
			...supporting('en', 'ja'),
			translations: { ja: { analytics: { viewTitle: 'アクセス解析' } } },
		} as Config['i18n'])
		expect(translate(out, 'ja', keys.viewTitle)).toBe('アクセス解析')
		expect(translate(out, 'ja', keys.viewNavLabel)).toBe('Analytics')
	})

	it("keep what the plugin's translations option sets for the language", async () => {
		const out = await configured(supporting('en', 'ja'), {
			translations: { ja: { [keys.viewNavLabel]: 'アクセス解析' } },
		})
		expect(translate(out, 'ja', keys.viewNavLabel)).toBe('アクセス解析')
		expect(translate(out, 'ja', keys.viewTitle)).toBe('Analytics')
	})

	it('leave the bundled languages as they are', async () => {
		const out = await configured(supporting('en', 'de', 'ja'))
		expect(translate(out, 'de', keys.viewRefresh)).toBe('Aktualisieren')
	})

	// Labels built where no `t` runs (a select's options, `admin.group`) carry the language too.
	it('give the static label maps the language, English first for Payload to fall back on', () => {
		const label = createStaticLabels({
			unbundled: ['ja'],
			plugin: { ja: { [keys.viewTimezone]: 'タイムゾーン' } },
		})
		expect(label(keys.viewTitle).ja).toBe('Analytics')
		expect(label(keys.viewTimezone).ja).toBe('タイムゾーン')
		expect(Object.keys(label(keys.viewTitle))[0]).toBe('en')
	})
})
