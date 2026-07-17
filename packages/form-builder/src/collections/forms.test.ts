import type { CollectionConfig, Field, PayloadRequest } from 'payload'
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
