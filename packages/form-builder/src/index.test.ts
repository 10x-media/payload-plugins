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

	const richTextFieldsOf = async (richText: Parameters<typeof formBuilder>[0]['richText']) => {
		const plugin = formBuilder({ richText })
		const config = { collections: [] } as unknown as Config
		const out = await Promise.resolve(plugin(config))
		const forms = out.collections?.find((c) => c.slug === 'forms')
		const tabsField = forms?.fields.find(
			(f): f is Extract<typeof f, { type: 'tabs' }> => f.type === 'tabs'
		)
		const tabFields = tabsField?.tabs.flatMap((tab) => ('fields' in tab ? tab.fields : [])) ?? []
		const blocksFieldNamed = (name: string) =>
			tabFields.find(
				(f): f is Extract<typeof f, { type: 'blocks' }> => 'name' in f && f.name === name
			)
		const fieldOf = (blocks: ReturnType<typeof blocksFieldNamed>, slug: string, name: string) =>
			blocks?.blocks
				?.find((b) => b.slug === slug)
				?.fields.find((f) => 'name' in f && f.name === name) as { editor?: unknown } | undefined
		const actionsField = blocksFieldNamed('actions')
		const fieldsField = blocksFieldNamed('fields')
		const responseGroup = tabFields.find(
			(f): f is Extract<typeof f, { type: 'group' }> =>
				f.type === 'group' && 'name' in f && f.name === 'response'
		)
		const responseMessage = responseGroup?.fields.find(
			(f) => 'name' in f && f.name === 'message'
		) as { editor?: unknown } | undefined
		const messageBlock = fieldsField?.blocks?.find((b) => b.slug === 'message')
		const messageContent = messageBlock?.fields.find((f) => 'name' in f && f.name === 'content') as
			| { editor?: unknown }
			| undefined
		const consentStatement = (() => {
			const block = fieldsField?.blocks?.find((b) => b.slug === 'consent')
			const tabs = block?.fields.find(
				(f): f is Extract<typeof f, { type: 'tabs' }> => f.type === 'tabs'
			)
			return tabs?.tabs
				.flatMap((tab) => ('fields' in tab ? tab.fields : []))
				.find((f) => 'name' in f && f.name === 'statement') as { editor?: unknown } | undefined
		})()
		return {
			emailTeamBody: fieldOf(actionsField, 'emailTeam', 'body'),
			confirmationBody: fieldOf(actionsField, 'confirmation', 'body'),
			messageContent,
			consentStatement,
			responseMessage,
		}
	}

	it('richText.editor is the default editor for every plugin richText field', async () => {
		const editor = { fake: 'editor' } as never
		const fields = await richTextFieldsOf({ editor })
		expect(fields.emailTeamBody?.editor).toBe(editor)
		expect(fields.confirmationBody?.editor).toBe(editor)
		expect(fields.messageContent?.editor).toBe(editor)
		expect(fields.consentStatement?.editor).toBe(editor)
		expect(fields.responseMessage?.editor).toBe(editor)
	})

	it('richText.bodyEditor overrides action bodies only, editor still covers the rest', async () => {
		const editor = { fake: 'editor' } as never
		const bodyEditor = { fake: 'bodyEditor' } as never
		const fields = await richTextFieldsOf({ editor, bodyEditor })
		expect(fields.emailTeamBody?.editor).toBe(bodyEditor)
		expect(fields.confirmationBody?.editor).toBe(bodyEditor)
		expect(fields.messageContent?.editor).toBe(editor)
		expect(fields.consentStatement?.editor).toBe(editor)
		expect(fields.responseMessage?.editor).toBe(editor)
	})

	it('richText.bodyEditor alone leaves non-body richText on the host default', async () => {
		const bodyEditor = { fake: 'bodyEditor' } as never
		const fields = await richTextFieldsOf({ bodyEditor })
		expect(fields.emailTeamBody?.editor).toBe(bodyEditor)
		expect(fields.confirmationBody?.editor).toBe(bodyEditor)
		expect(fields.messageContent && 'editor' in fields.messageContent).toBe(false)
		expect(fields.consentStatement && 'editor' in fields.consentStatement).toBe(false)
		expect(fields.responseMessage && 'editor' in fields.responseMessage).toBe(false)
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

	it('exports toFormDocument from the root and maps a doc', async () => {
		const moduleExports = await import('./index')
		const doc = moduleExports.toFormDocument({ id: 1, fields: [] })
		expect(doc).toEqual({ id: 1, fields: [] })
	})

	const buildWithEmail = async (email: Parameters<typeof formBuilder>[0]['email']) => {
		const plugin = formBuilder({ email })
		const config = { collections: [] } as unknown as Config
		const out = await Promise.resolve(plugin(config))
		const forms = out.collections?.find((c) => c.slug === 'forms')
		const tabsField = forms?.fields.find(
			(f): f is Extract<typeof f, { type: 'tabs' }> => f.type === 'tabs'
		)
		const tabFields = tabsField?.tabs.flatMap((tab) => ('fields' in tab ? tab.fields : [])) ?? []
		const actionsField = tabFields.find(
			(f): f is Extract<typeof f, { type: 'blocks' }> => 'name' in f && f.name === 'actions'
		)
		const fromFieldOf = (slug: string) =>
			actionsField?.blocks
				?.find((b) => b.slug === slug)
				?.fields.find((f) => 'name' in f && f.name === 'from')
		const endpoints = forms?.endpoints as Array<{ path: string }> | undefined
		return {
			emailTeamFrom: fromFieldOf('emailTeam'),
			confirmationFrom: fromFieldOf('confirmation'),
			hasFromAddressesEndpoint: endpoints?.some((e) => e.path === '/:id/from-addresses') ?? false,
		}
	}

	it('adds no from field and no endpoint when email.fromAddresses is unset', async () => {
		const result = await buildWithEmail(undefined)
		expect(result.emailTeamFrom).toBeUndefined()
		expect(result.confirmationFrom).toBeUndefined()
		expect(result.hasFromAddressesEndpoint).toBe(false)
	})

	it('adds a from field to both email actions and registers the endpoint when email.fromAddresses is set', async () => {
		const result = await buildWithEmail({ fromAddresses: () => [] })
		expect(result.emailTeamFrom).toBeDefined()
		expect(result.confirmationFrom).toBeDefined()
		expect(result.hasFromAddressesEndpoint).toBe(true)
	})
})
