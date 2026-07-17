import type { CollectionConfig, Condition, Field, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
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
	const poll = collection.fields.find(
		(field) => 'name' in field && field.name === 'poll'
	) as Extract<Field, { type: 'group' }>
	return poll.fields.find((field) => 'name' in field && field.name === 'resultsField') as Extract<
		Field,
		{ type: 'text' }
	>
}

const clientComponentOf = (field: Extract<Field, { type: 'text' }>) =>
	field.admin?.components?.Field as
		| { path?: string; clientProps?: { types?: string[] } }
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

	it('gates every conditional poll field on the poll group being enabled', () => {
		const poll = groupNamed(collection.fields, 'poll')
		for (const name of ['resultsField', 'resultsVisibility', 'closesAt', 'outcome']) {
			const condition = conditionOf(poll.fields, name)
			expect(condition({}, { enabled: true }, props)).toBe(true)
			expect(condition({}, { enabled: false }, props)).toBe(false)
			expect(condition({}, {}, props)).toBe(false)
		}
	})

	it('reads the poll group, not the document, for the poll enabled gate', () => {
		const poll = groupNamed(collection.fields, 'poll')
		const condition = conditionOf(poll.fields, 'closesAt')
		expect(condition({ enabled: true }, { enabled: false }, props)).toBe(false)
		expect(condition({ poll: { enabled: true } }, {}, props)).toBe(false)
	})
})

describe('forms poll.resultsField', () => {
	it('mounts FieldNameSelect with the poll-eligible types as clientProps', () => {
		const field = resultsFieldOf(buildCollection())
		const component = clientComponentOf(field)
		expect(component?.path).toBe('@10x-media/form-builder/client#FieldNameSelect')
		expect(component?.clientProps?.types).toEqual(['select'])
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

	it('stores a plain text name, keeps the PII description, and stays gated on enabled', () => {
		const field = resultsFieldOf(buildCollection())
		expect(field.type).toBe('text')
		expect(field.admin?.description).toBeDefined()
		expect(typeof field.validate).toBe('function')
		const condition = field.admin?.condition
		expect(condition?.({}, { enabled: true }, {} as never)).toBe(true)
		expect(condition?.({}, { enabled: false }, {} as never)).toBe(false)
		expect(condition?.({}, {}, {} as never)).toBe(false)
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
