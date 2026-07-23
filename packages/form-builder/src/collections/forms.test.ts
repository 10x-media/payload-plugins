import type { CollectionConfig, Condition, Field, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { RichTextBodyOption } from '../actions/body/serializeBody'
import type { FromAddressOption } from '../actions/fromAddresses'
import { buildDefaultFieldDefinitions } from '../fields/builtin'
import { type FieldTypesConfig, resolveFieldTypes } from '../fields/registry'
import type { AnyFormFieldDefinition } from '../fields/types'
import { defaultValidationRules } from '../validation/builtin'
import { resolveValidationRules } from '../validation/registry'
import { buildFormsCollection } from './forms'

const buildCollection = (fields?: FieldTypesConfig): CollectionConfig =>
	buildFormsCollection({
		registry: resolveFieldTypes(buildDefaultFieldDefinitions(true), fields),
		ruleRegistry: resolveValidationRules(defaultValidationRules),
	})

const resultsFieldOf = (collection: CollectionConfig) => {
	const poll = groupNamed(tabFields(collection), 'poll')
	return poll.fields.find((field) => 'name' in field && field.name === 'resultsField') as Extract<
		Field,
		{ type: 'text' }
	>
}

const clientComponentOf = (field: Extract<Field, { type: 'text' }>) =>
	field.admin?.components?.Field as
		| { path?: string; clientProps?: { types?: string[]; descriptionKey?: string } }
		| undefined

const groupNamed = (fields: Field[], name: string): Extract<Field, { type: 'group' }> => {
	const group = fields.find((field) => 'name' in field && field.name === name)
	if (group?.type !== 'group') {
		throw new Error(`missing group ${name}`)
	}
	return group
}

const conditionOf = (fields: Field[], name: string) => {
	const field = fields.find((f) => 'name' in f && f.name === name)
	const condition = (field?.admin as { condition?: Condition } | undefined)?.condition
	if (typeof condition !== 'function') {
		throw new Error(`missing admin.condition on ${name}`)
	}
	return condition
}

/** Payload types the third argument as always present; conditions here read only the first two. */
const props = {} as Parameters<Condition>[2]

const tabFields = (collection: CollectionConfig): Field[] => {
	const tabs = collection.fields.find((field) => field.type === 'tabs')
	if (tabs?.type !== 'tabs') {
		throw new Error('missing tabs')
	}
	return tabs.tabs.flatMap((tab) => tab.fields)
}

/** The `admin.condition` of the (presentational) tab that contains a field with the given name. */
const tabConditionByField = (collection: CollectionConfig, fieldName: string): Condition => {
	const tabs = collection.fields.find((field) => field.type === 'tabs')
	if (tabs?.type !== 'tabs') {
		throw new Error('missing tabs')
	}
	const tab = tabs.tabs.find((t) => t.fields.some((f) => 'name' in f && f.name === fieldName))
	const condition = (tab?.admin as { condition?: Condition } | undefined)?.condition
	if (typeof condition !== 'function') {
		throw new Error(`missing admin.condition on the tab containing ${fieldName}`)
	}
	return condition
}

/**
 * Every `admin.condition` in the forms collection reads `siblingData`, so each must be gated by the
 * group it actually sits in. Reading the wrong scope is silent (the field just never shows) and is
 * the bug class round one hit on the consent block.
 */
describe('forms admin.condition scopes', () => {
	const collection = buildCollection()

	it('gates response.message and response.redirect on their own group type', () => {
		const response = groupNamed(tabFields(collection), 'response')
		const message = conditionOf(response.fields, 'message')
		const redirect = conditionOf(response.fields, 'redirect')

		expect(message({}, { type: 'message' }, props)).toBe(true)
		expect(message({}, { type: 'redirect' }, props)).toBe(false)
		expect(redirect({}, { type: 'redirect' }, props)).toBe(true)
		expect(redirect({}, { type: 'message' }, props)).toBe(false)
	})

	it('sets the response message editor from richText.responseEditor, falling back to editor', () => {
		const editor = { name: 'plugin-editor' } as never
		const responseEditor = { name: 'response-editor' } as never
		const build = (richText?: RichTextBodyOption) =>
			buildFormsCollection({
				registry: resolveFieldTypes(buildDefaultFieldDefinitions(true)),
				ruleRegistry: resolveValidationRules(defaultValidationRules),
				richText,
			})
		const messageEditor = (col: CollectionConfig) => {
			const response = groupNamed(tabFields(col), 'response')
			const message = response.fields.find((f) => 'name' in f && f.name === 'message')
			return (message as { editor?: unknown } | undefined)?.editor
		}
		expect(messageEditor(build({ editor, responseEditor }))).toBe(responseEditor)
		expect(messageEditor(build({ editor }))).toBe(editor)
		expect(messageEditor(build())).toBeUndefined()
	})

	it('treats an unset response.type as message, matching the client fallback', () => {
		const response = groupNamed(tabFields(collection), 'response')
		expect(conditionOf(response.fields, 'message')({}, {}, props)).toBe(true)
		expect(conditionOf(response.fields, 'redirect')({}, {}, props)).toBe(false)
	})

	it('reads the response group, not the document, for response.message', () => {
		const response = groupNamed(tabFields(collection), 'response')
		const message = conditionOf(response.fields, 'message')
		expect(message({ type: 'redirect' }, { type: 'message' }, props)).toBe(true)
		expect(message({ type: 'message' }, { type: 'redirect' }, props)).toBe(false)
	})

	it('gates the Flow and Poll tabs on the document-level flags', () => {
		// A presentational tab's `admin.condition` reads the whole document as its 2nd argument, so
		// the Flow tab keys off `multistep` and the Poll tab off `pollEnabled`, both at the root.
		const flow = tabConditionByField(collection, 'flow')
		expect(flow({}, { multistep: true }, props)).toBe(true)
		expect(flow({}, { multistep: false }, props)).toBe(false)
		expect(flow({}, {}, props)).toBe(false)

		const poll = tabConditionByField(collection, 'poll')
		expect(poll({}, { pollEnabled: true }, props)).toBe(true)
		expect(poll({}, { pollEnabled: false }, props)).toBe(false)
		expect(poll({}, {}, props)).toBe(false)
	})

	it('no longer gates individual poll fields on enabled (the Poll tab owns that gate)', () => {
		const poll = groupNamed(tabFields(collection), 'poll')
		for (const name of ['resultsField', 'resultsVisibility', 'closesAt', 'outcome']) {
			const field = poll.fields.find((f) => 'name' in f && f.name === name)
			expect((field?.admin as { condition?: unknown } | undefined)?.condition).toBeUndefined()
		}
	})
})

describe('forms response.redirect.reference', () => {
	it('omits the reference field when redirectRelationships is unset', () => {
		const collection = buildCollection()
		const redirect = groupNamed(groupNamed(tabFields(collection), 'response').fields, 'redirect')
		expect(redirect.fields.some((field) => 'name' in field && field.name === 'reference')).toBe(
			false
		)
		expect(redirect.fields.some((field) => 'name' in field && field.name === 'url')).toBe(true)
	})

	it('omits the reference field when redirectRelationships is an empty array', () => {
		const collection = buildFormsCollection({
			registry: resolveFieldTypes(buildDefaultFieldDefinitions(true)),
			ruleRegistry: resolveValidationRules(defaultValidationRules),
			redirectRelationships: [],
		})
		const redirect = groupNamed(groupNamed(tabFields(collection), 'response').fields, 'redirect')
		expect(redirect.fields.some((field) => 'name' in field && field.name === 'reference')).toBe(
			false
		)
	})

	it('adds a polymorphic reference relationship field when redirectRelationships is set', () => {
		const collection = buildFormsCollection({
			registry: resolveFieldTypes(buildDefaultFieldDefinitions(true)),
			ruleRegistry: resolveValidationRules(defaultValidationRules),
			redirectRelationships: ['pages', 'articles'],
		})
		const redirect = groupNamed(groupNamed(tabFields(collection), 'response').fields, 'redirect')
		const reference = redirect.fields.find(
			(field) => 'name' in field && field.name === 'reference'
		) as Extract<Field, { type: 'relationship' }> | undefined
		expect(reference?.type).toBe('relationship')
		expect(reference?.relationTo).toEqual(['pages', 'articles'])
		expect(redirect.fields.some((field) => 'name' in field && field.name === 'url')).toBe(true)
	})
})

describe('forms response.redirect.fields', () => {
	const redirectOf = (collection: CollectionConfig) =>
		groupNamed(groupNamed(tabFields(collection), 'response').fields, 'redirect')

	it('keeps the default url field when no override is passed', () => {
		const redirect = redirectOf(buildCollection())
		expect(redirect.fields.some((field) => 'name' in field && field.name === 'url')).toBe(true)
	})

	it('composes the redirect group fields through the response.redirect.fields seam', () => {
		let received: Field[] | undefined
		const link: Field = { name: 'link', type: 'text' }
		const collection = buildFormsCollection({
			registry: resolveFieldTypes(buildDefaultFieldDefinitions(true)),
			ruleRegistry: resolveValidationRules(defaultValidationRules),
			response: {
				redirect: {
					fields: ({ defaultFields }) => {
						received = defaultFields
						return [link, ...defaultFields]
					},
				},
			},
		})
		const redirect = redirectOf(collection)
		// The seam is handed the built-in url field as a default...
		expect(received?.some((field) => 'name' in field && field.name === 'url')).toBe(true)
		// ...and its returned array (custom field prepended, defaults kept) is the group's fields.
		expect(redirect.fields[0]).toMatchObject({ name: 'link' })
		expect(redirect.fields.some((field) => 'name' in field && field.name === 'url')).toBe(true)
	})
})

describe('forms poll.resultsField', () => {
	it('mounts FieldNameSelect with the poll-eligible types as clientProps', () => {
		const field = resultsFieldOf(buildCollection())
		const component = clientComponentOf(field)
		expect(component?.path).toBe('@10x-media/form-builder/client#FieldNameSelect')
		expect(component?.clientProps?.types).toEqual(['select'])
	})

	it('threads the PII-warning description in as a translation key, not admin.description', () => {
		const field = resultsFieldOf(buildCollection())
		// A custom Field component replaces Payload's whole default render, including the
		// description slot, so admin.description would be silently inert here; the description
		// must travel as a clientProp the component resolves and renders itself.
		expect(clientComponentOf(field)?.clientProps?.descriptionKey).toBe(
			'formBuilder:poll.resultsFieldDescription'
		)
		expect(field.admin?.description).toBeUndefined()
	})

	it('threads custom pollEligible types into the select options', () => {
		const athleteVote: AnyFormFieldDefinition = {
			type: 'athleteVote',
			label: 'Athlete vote',
			value: 'text',
			pollEligible: true,
		}
		const field = resultsFieldOf(buildCollection({ athleteVote }))
		expect(clientComponentOf(field)?.clientProps?.types).toEqual(['select', 'athleteVote'])
	})

	it('stores a plain text name with no condition of its own', () => {
		const field = resultsFieldOf(buildCollection())
		expect(field.type).toBe('text')
		expect(typeof field.validate).toBe('function')
		expect(field.admin?.condition).toBeUndefined()
	})
})

describe('forms /:id/from-addresses endpoint', () => {
	const options: FromAddressOption[] = [{ label: 'Support', value: 'support@example.com' }]

	const endpointOf = (collection: CollectionConfig) =>
		(
			collection.endpoints as Array<{ path: string; handler: (req: PayloadRequest) => unknown }>
		)?.find((endpoint) => endpoint.path === '/:id/from-addresses')

	it('registers the endpoint only when fromAddresses is set', () => {
		const withResolver = buildFormsCollection({
			registry: resolveFieldTypes(buildDefaultFieldDefinitions(true)),
			ruleRegistry: resolveValidationRules(defaultValidationRules),
			fromAddresses: () => options,
		})
		expect(endpointOf(withResolver)).toBeDefined()

		const withoutResolver = buildCollection()
		expect(endpointOf(withoutResolver)).toBeUndefined()
	})

	it('refuses anonymous requests without calling the resolver', async () => {
		const resolver = vi.fn()
		const collection = buildFormsCollection({
			registry: resolveFieldTypes(buildDefaultFieldDefinitions(true)),
			ruleRegistry: resolveValidationRules(defaultValidationRules),
			fromAddresses: resolver,
		})
		const response = (await endpointOf(collection)?.handler({
			user: undefined,
		} as unknown as PayloadRequest)) as Response
		expect(response.status).toBe(403)
		expect(resolver).not.toHaveBeenCalled()
	})

	it('serves the resolver options to authed requests, threading req through for tenant scoping', async () => {
		const tenantOptions: Record<string, FromAddressOption[]> = {
			acme: [{ label: 'Acme support', value: 'support@acme.example.com' }],
			globex: [{ label: 'Globex support', value: 'support@globex.example.com' }],
		}
		const collection = buildFormsCollection({
			registry: resolveFieldTypes(buildDefaultFieldDefinitions(true)),
			ruleRegistry: resolveValidationRules(defaultValidationRules),
			fromAddresses: ({ req }) => {
				const tenant = (req.user as { tenant?: string } | undefined)?.tenant ?? ''
				return tenantOptions[tenant] ?? []
			},
		})
		const endpoint = endpointOf(collection)

		const acmeReq = { user: { tenant: 'acme' } } as unknown as PayloadRequest
		const acmeResponse = (await endpoint?.handler(acmeReq)) as Response
		expect(acmeResponse.status).toBe(200)
		expect(await acmeResponse.json()).toEqual({ options: tenantOptions.acme })

		const globexReq = { user: { tenant: 'globex' } } as unknown as PayloadRequest
		const globexResponse = (await endpoint?.handler(globexReq)) as Response
		expect(await globexResponse.json()).toEqual({ options: tenantOptions.globex })
	})

	it('ignores the route id: any id (or none) serves the same request-scoped options', async () => {
		const collection = buildFormsCollection({
			registry: resolveFieldTypes(buildDefaultFieldDefinitions(true)),
			ruleRegistry: resolveValidationRules(defaultValidationRules),
			fromAddresses: () => options,
		})
		const endpoint = endpointOf(collection)
		const req = { user: { id: 1 }, routeParams: { id: '999999' } } as unknown as PayloadRequest
		const response = (await endpoint?.handler(req)) as Response
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ options })
	})

	it('fails closed (503) when the resolver throws', async () => {
		const collection = buildFormsCollection({
			registry: resolveFieldTypes(buildDefaultFieldDefinitions(true)),
			ruleRegistry: resolveValidationRules(defaultValidationRules),
			fromAddresses: () => {
				throw new Error('boom')
			},
		})
		const req = { user: { id: 1 } } as unknown as PayloadRequest
		const response = (await endpointOf(collection)?.handler(req)) as Response
		expect(response.status).toBe(503)
	})
})
