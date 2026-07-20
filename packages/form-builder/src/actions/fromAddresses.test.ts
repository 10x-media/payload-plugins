import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import {
	buildFromField,
	type FromAddressOption,
	resolveFromAddressesRequest,
	validateFromField,
} from './fromAddresses'

const options: FromAddressOption[] = [
	{ label: 'Support', value: 'Support <support@example.com>' },
	{ label: 'Sales', value: 'sales@example.com' },
]

const req = { t: (key: string) => key } as unknown as PayloadRequest

describe('buildFromField', () => {
	const field = buildFromField(() => options)

	it('is a text field named "from" mounting EndpointOptionsSelect on the from-addresses endpoint', () => {
		expect(field.name).toBe('from')
		expect(field.type).toBe('text')
		const component = field.admin?.components?.Field as
			| { path?: string; clientProps?: { endpoint?: string; descriptionKey?: string } }
			| undefined
		expect(component?.path).toBe('@10x-media/form-builder/client#EndpointOptionsSelect')
		expect(component?.clientProps?.endpoint).toBe('from-addresses')
		expect(component?.clientProps?.descriptionKey).toBe('formBuilder:action.config.fromDescription')
	})

	it('carries a validate function', () => {
		expect(typeof field.validate).toBe('function')
	})
})

describe('validateFromField', () => {
	it('passes when unset', async () => {
		const validate = validateFromField(() => options)
		expect(await validate(undefined, { req })).toBe(true)
		expect(await validate('', { req })).toBe(true)
	})

	it('passes when the value matches a resolved option', async () => {
		const validate = validateFromField(() => options)
		expect(await validate('sales@example.com', { req })).toBe(true)
	})

	it('fails when the value is not among the resolved options', async () => {
		const validate = validateFromField(() => options)
		expect(await validate('nope@example.com', { req })).toBe('formBuilder:validation.fromUnknown')
	})

	it('awaits an async resolver', async () => {
		const validate = validateFromField(async () => options)
		expect(await validate('sales@example.com', { req })).toBe(true)
	})

	it('passes req through to the resolver', async () => {
		const resolver = vi.fn().mockResolvedValue(options)
		const validate = validateFromField(resolver)
		await validate('sales@example.com', { req })
		expect(resolver).toHaveBeenCalledWith({ req })
	})

	it('fails closed with a translated message when the resolver throws', async () => {
		const validate = validateFromField(() => {
			throw new Error('boom')
		})
		expect(await validate('sales@example.com', { req })).toBe(
			'formBuilder:validation.fromUnavailable'
		)
	})
})

describe('resolveFromAddressesRequest', () => {
	it('refuses anonymous callers without invoking the resolver', async () => {
		const resolver = vi.fn()
		const result = await resolveFromAddressesRequest({ isAuthed: false, req, resolver })
		expect(result.status).toBe(403)
		expect(resolver).not.toHaveBeenCalled()
	})

	it('serves the resolver options to authed callers', async () => {
		const result = await resolveFromAddressesRequest({
			isAuthed: true,
			req,
			resolver: () => options,
		})
		expect(result.status).toBe(200)
		expect('options' in result.body ? result.body.options : []).toEqual(options)
	})

	it('passes req through to the resolver', async () => {
		const resolver = vi.fn().mockResolvedValue(options)
		await resolveFromAddressesRequest({ isAuthed: true, req, resolver })
		expect(resolver).toHaveBeenCalledWith({ req })
	})

	it('fails closed (503) when the resolver throws', async () => {
		const result = await resolveFromAddressesRequest({
			isAuthed: true,
			req,
			resolver: () => {
				throw new Error('boom')
			},
		})
		expect(result.status).toBe(503)
		expect('errors' in result.body).toBe(true)
	})
})
