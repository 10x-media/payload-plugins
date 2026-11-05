import { describe, expect, it } from 'vitest'
import { ar } from './ar'
import { de } from './de'
import { en } from './en'
import { keys } from './keys'
import { builtInStaticLabel, createStaticLabels } from './staticLabel'
import { zh } from './zh'

describe('createStaticLabels', () => {
	it('carries every shipped locale of a key', () => {
		const label = builtInStaticLabel(keys.pluginName)
		expect(Object.keys(label).sort()).toEqual([
			'ar',
			'de',
			'en',
			'es',
			'fr',
			'id',
			'ko',
			'pt',
			'ru',
			'uk',
			'zh',
		])
		expect(label.en).toBe(en[keys.pluginName])
		expect(label.ar).toBe(ar[keys.pluginName])
		expect(label.zh).toBe(zh[keys.pluginName])
	})

	it("lets the plugin's translations option win over the built-in strings and add a locale", () => {
		const staticLabel = createStaticLabels({
			plugin: {
				de: { [keys.pluginName]: 'Statistiken' },
				nl: { [keys.pluginName]: 'Statistieken' },
			},
		})
		const label = staticLabel(keys.pluginName)
		expect(label.de).toBe('Statistiken')
		expect(label.nl).toBe('Statistieken')
		expect(label.en).toBe(en[keys.pluginName])
		expect(staticLabel(keys.metricPageviews).de).toBe(de[keys.metricPageviews])
	})

	it("lets the app's own i18n.translations win over the plugin's", () => {
		const staticLabel = createStaticLabels({
			app: { de: { analytics: { pluginName: 'Auswertung' } }, fr: { general: { save: 'x' } } },
			plugin: { de: { [keys.pluginName]: 'Statistiken' } },
		})
		expect(staticLabel(keys.pluginName).de).toBe('Auswertung')
		expect(staticLabel(keys.pluginName).fr).toBe(builtInStaticLabel(keys.pluginName).fr)
	})

	it('builds each key once, so a config holds one map per key', () => {
		const staticLabel = createStaticLabels({ plugin: { en: { [keys.pluginName]: 'Stats' } } })
		expect(staticLabel(keys.pluginName)).toBe(staticLabel(keys.pluginName))
	})

	it('ignores app strings that are not strings', () => {
		const staticLabel = createStaticLabels({ app: { en: { analytics: { pluginName: 42 } } } })
		expect(staticLabel(keys.pluginName).en).toBe(en[keys.pluginName])
	})
})
