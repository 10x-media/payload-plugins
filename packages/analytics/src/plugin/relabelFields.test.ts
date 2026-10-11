import type { Config, SelectField, UIField } from 'payload'
import { describe, expect, it } from 'vitest'
import { analyticsStatRow, analyticsTab } from '../fields/factories'
import { analyticsProviderFields } from '../providers/collection'
import { keys } from '../translations/keys'
import { createStaticLabels } from '../translations/staticLabel'
import { relabelFactoryFields } from './relabelFields'
import { walkFields } from './walkFields'

const staticLabel = createStaticLabels({
	plugin: {
		de: { [keys.tabAnalytics]: 'Statistik', [keys.providerFieldProviderHelp]: 'Welcher Dienst' },
		nl: { [keys.tabAnalytics]: 'Statistieken' },
	},
})

const hostConfig = (): Config =>
	({
		collections: [
			{
				slug: 'pages',
				fields: [{ type: 'tabs', tabs: [analyticsTab()] }, analyticsStatRow()],
			},
			{ slug: 'settings', fields: analyticsProviderFields() },
		],
		globals: [{ slug: 'site', fields: [analyticsStatRow({ name: 'site_stats' })] }],
	}) as Config

const uiFields = (config: Config): UIField[] =>
	[...walkFields(config.collections?.flatMap((c) => c.fields) ?? [])].filter(
		(field): field is UIField => field.type === 'ui'
	)

describe('relabelFactoryFields', () => {
	it("gives the factories' fields the install's own static labels", () => {
		const config = hostConfig()
		relabelFactoryFields(config, staticLabel)
		for (const field of uiFields(config)) {
			expect(field.label).toEqual(staticLabel(keys.tabAnalytics))
		}
		const label = uiFields(config)[0]?.label
		expect(typeof label === 'object' ? label.de : undefined).toBe('Statistik')
		expect(typeof label === 'object' ? label.nl : undefined).toBe('Statistieken')
		const global = config.globals?.[0]?.fields[0]
		expect(global && 'label' in global ? global.label : undefined).toEqual(
			staticLabel(keys.tabAnalytics)
		)
	})

	it('relabels a description the provider fields carry as a locale map', () => {
		const config = hostConfig()
		relabelFactoryFields(config, staticLabel)
		const provider = [...walkFields(config.collections?.[1]?.fields ?? [])].find(
			(field): field is SelectField => 'name' in field && field.name === 'provider'
		)
		const description = provider?.admin?.description
		expect(typeof description === 'object' ? description.de : undefined).toBe('Welcher Dienst')
	})

	it('leaves every label a host wrote alone', () => {
		const config: Config = {
			collections: [
				{ slug: 'posts', fields: [{ name: 'title', type: 'text', label: { en: 'Title' } }] },
			],
		} as Config
		relabelFactoryFields(config, staticLabel)
		const title = config.collections?.[0]?.fields[0]
		expect(title && 'label' in title ? title.label : undefined).toEqual({ en: 'Title' })
	})
})
