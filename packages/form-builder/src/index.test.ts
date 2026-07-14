import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'
import { formBuilder } from './index'
import { keys } from './translations'

describe('formBuilder factory', () => {
	it('is a definePlugin plugin carrying the package slug', () => {
		const plugin = formBuilder({})
		expect(typeof plugin).toBe('function')
		expect(plugin.slug).toBe('@10x-media/form-builder')
	})

	it('applies the translations option', async () => {
		const plugin = formBuilder({ translations: { de: { [keys.fieldTitle]: 'Titel' } } })
		const config = { collections: [] } as unknown as Config
		const out = await Promise.resolve(plugin(config))
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.formBuilder?.fieldTitle).toBe('Titel')
		expect(i18n.en?.formBuilder?.fieldTitle).toBe('Title')
	})

	it('threads richText.editor onto both action body fields', async () => {
		const editor = { fake: 'editor' } as never
		const plugin = formBuilder({ richText: { editor } })
		const config = { collections: [] } as unknown as Config
		const out = await Promise.resolve(plugin(config))
		const forms = out.collections?.find((c) => c.slug === 'forms')
		const tabsField = forms?.fields.find(
			(f): f is Extract<typeof f, { type: 'tabs' }> => f.type === 'tabs'
		)
		const actionsField = tabsField?.tabs
			.flatMap((tab) => ('fields' in tab ? tab.fields : []))
			.find((f): f is Extract<typeof f, { type: 'blocks' }> => 'name' in f && f.name === 'actions')
		const bodyFieldOf = (blockSlug: string) => {
			const block = actionsField?.blocks?.find((b) => b.slug === blockSlug)
			return block?.fields.find((f) => 'name' in f && f.name === 'body') as
				| { editor?: unknown }
				| undefined
		}
		expect(bodyFieldOf('emailTeam')?.editor).toBe(editor)
		expect(bodyFieldOf('confirmation')?.editor).toBe(editor)
	})

	it('returns the config untouched when disabled', async () => {
		const plugin = formBuilder({ disabled: true })
		const config = { collections: [{ slug: 'users', fields: [] }] } as unknown as Config
		const result = await Promise.resolve(plugin(config))
		expect(result.collections).toHaveLength(1)
	})

	it('exports the defineFormField primitive', async () => {
		const moduleExports = await import('./index')
		expect(typeof moduleExports.defineFormField).toBe('function')
	})

	it('exports the defineValidationRule primitive', async () => {
		const moduleExports = await import('./index')
		expect(typeof moduleExports.defineValidationRule).toBe('function')
	})

	it('exports the evaluateCondition engine', async () => {
		const moduleExports = await import('./index')
		expect(typeof moduleExports.evaluateCondition).toBe('function')
	})

	it('exports the response aggregation helpers', async () => {
		const moduleExports = await import('./index')
		expect(typeof moduleExports.aggregateFormResponses).toBe('function')
		expect(typeof moduleExports.aggregateFieldResponses).toBe('function')
	})

	it('exports the results-request gating helper', async () => {
		const moduleExports = await import('./index')
		expect(typeof moduleExports.resolveFormResultsRequest).toBe('function')
		expect(typeof moduleExports.fieldHasOptions).toBe('function')
	})
})
