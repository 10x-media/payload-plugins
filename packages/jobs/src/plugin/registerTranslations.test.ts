import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { keys } from '../translations/keys'
import { registerTranslations } from './registerTranslations'

type Nested = Record<string, Record<string, Record<string, string>>>

const translationsOf = (config: Config): Nested => (config.i18n?.translations ?? {}) as Nested

describe('registerTranslations', () => {
	it('registers the built-in locales when no overrides are given', () => {
		const config = {} as Config
		registerTranslations(config)
		expect(translationsOf(config).en?.jobs?.pluginName).toBe('Jobs')
	})

	it('lets an override win over a built-in key', () => {
		const config = {} as Config
		registerTranslations(config, { en: { [keys.pluginName]: 'Background work' } })
		expect(translationsOf(config).en?.jobs?.pluginName).toBe('Background work')
	})

	it('keeps untouched keys intact next to an override', () => {
		const config = {} as Config
		registerTranslations(config, { en: { [keys.pluginName]: 'Background work' } })
		const en = translationsOf(config).en?.jobs
		expect(en?.statusQueued).toBe('Queued')
		expect(en?.fieldStatus).toBe('Status')
	})

	it('passes a locale the plugin does not ship through whole', () => {
		const config = {} as Config
		registerTranslations(config, {
			de: { [keys.pluginName]: 'Aufgaben', [keys.statusQueued]: 'Wartend' },
		})
		expect(translationsOf(config).de?.jobs).toEqual({
			pluginName: 'Aufgaben',
			statusQueued: 'Wartend',
		})
		expect(translationsOf(config).en?.jobs?.pluginName).toBe('Jobs')
	})

	it('lets a pre-registered host value win over an override', () => {
		const config = {
			i18n: { translations: { en: { jobs: { pluginName: 'Host' } } } },
		} as unknown as Config
		registerTranslations(config, { en: { [keys.pluginName]: 'Override' } })
		expect(translationsOf(config).en?.jobs?.pluginName).toBe('Host')
		expect(translationsOf(config).en?.jobs?.statusQueued).toBe('Queued')
	})

	it('skips undefined override values', () => {
		const config = {} as Config
		registerTranslations(config, { en: { [keys.pluginName]: undefined } })
		expect(translationsOf(config).en?.jobs?.pluginName).toBe('Jobs')
	})

	it('rejects keys outside the typed key set', () => {
		registerTranslations({} as Config, {
			en: {
				// @ts-expect-error a typo'd translation key must not typecheck
				'jobs:doesNotExist': 'x',
			},
		})
	})
})
