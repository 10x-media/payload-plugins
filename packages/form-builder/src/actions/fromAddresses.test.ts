import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import {
	buildFromField,
	type FromAddressOption,
	type FromAddressSource,
	resolveFromAddressesRequest,
	resolveSendFrom,
	validateFromField,
} from './fromAddresses'
import type { RecipientResolveArgs } from './recipientSources'

const options: FromAddressOption[] = [
	{ label: 'Support', value: 'Support <support@example.com>' },
	{ label: 'Sales', value: 'sales@example.com' },
]

const req = { t: (key: string) => key } as unknown as PayloadRequest

const tenantSource: FromAddressSource = {
	value: 'tenant:default',
	label: 'Tenant default',
	resolve: () => 'Acme <hello@acme.example>',
}

const sendArgs = {
	context: null,
	values: [],
	descriptors: [],
	form: { id: 'form-1' },
	submissionId: 'sub-1',
	payload: {} as never,
	locale: 'en',
} as unknown as RecipientResolveArgs

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

	it('marks the select request-scoped so options load before the first save', () => {
		const component = field.admin?.components?.Field as
			| { clientProps?: { scope?: string } }
			| undefined
		expect(component?.clientProps?.scope).toBe('request')
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

	it('passes when the value is a registered source, without calling the resolver', async () => {
		const resolver = vi.fn()
		const validate = validateFromField(resolver, new Set(['tenant:default']))
		expect(await validate('tenant:default', { req })).toBe(true)
		expect(resolver).not.toHaveBeenCalled()
	})

	it('validates against sources alone when no resolver is configured', async () => {
		const validate = validateFromField(undefined, new Set(['tenant:default']))
		expect(await validate('tenant:default', { req })).toBe(true)
		expect(await validate('nope@example.com', { req })).toBe('formBuilder:validation.fromUnknown')
	})
})

describe('resolveSendFrom', () => {
	const sources = new Map([[tenantSource.value, tenantSource]])

	it('returns undefined when nothing is configured', async () => {
		expect(await resolveSendFrom({ configured: undefined, sources, sourceArgs: sendArgs })).toBe(
			undefined
		)
		expect(await resolveSendFrom({ configured: '', sources, sourceArgs: sendArgs })).toBe(undefined)
	})

	it('forwards a literal address verbatim without touching any source', async () => {
		const resolve = vi.fn()
		const spySources = new Map([['tenant:default', { ...tenantSource, resolve }]])
		expect(
			await resolveSendFrom({
				configured: 'Support <support@example.com>',
				sources: spySources,
				sourceArgs: sendArgs,
			})
		).toBe('Support <support@example.com>')
		expect(resolve).not.toHaveBeenCalled()
	})

	it('resolves a source value freshly at send time with the run args', async () => {
		const resolve = vi.fn().mockResolvedValue('Acme <hello@acme.example>')
		const spySources = new Map([['tenant:default', { ...tenantSource, resolve }]])
		expect(
			await resolveSendFrom({
				configured: 'tenant:default',
				sources: spySources,
				sourceArgs: sendArgs,
			})
		).toBe('Acme <hello@acme.example>')
		expect(resolve).toHaveBeenCalledWith(sendArgs)
	})

	it('falls back to the adapter default (undefined) when the source resolves empty', async () => {
		const empty = new Map([
			['tenant:default', { ...tenantSource, resolve: () => null } as FromAddressSource],
		])
		expect(
			await resolveSendFrom({ configured: 'tenant:default', sources: empty, sourceArgs: sendArgs })
		).toBe(undefined)
	})

	it('clamps a source result to a single address', async () => {
		const multi = new Map([
			[
				'tenant:default',
				{ ...tenantSource, resolve: () => 'a@acme.example, b@acme.example' } as FromAddressSource,
			],
		])
		expect(
			await resolveSendFrom({ configured: 'tenant:default', sources: multi, sourceArgs: sendArgs })
		).toBe('a@acme.example')
	})

	it('preserves a display-name sender while cutting anything past a separator', async () => {
		const injected = new Map([
			[
				'tenant:default',
				{
					...tenantSource,
					resolve: () => 'Acme <hello@acme.example>\nbcc-me@evil.example',
				} as FromAddressSource,
			],
		])
		expect(
			await resolveSendFrom({
				configured: 'tenant:default',
				sources: injected,
				sourceArgs: sendArgs,
			})
		).toBe('Acme <hello@acme.example>')
	})

	it('keeps a quoted display name containing a comma intact', async () => {
		const quoted = new Map([
			[
				'tenant:default',
				{
					...tenantSource,
					resolve: () => '"Fox, Jessica" <jfox@acme.example>',
				} as FromAddressSource,
			],
		])
		expect(
			await resolveSendFrom({ configured: 'tenant:default', sources: quoted, sourceArgs: sendArgs })
		).toBe('"Fox, Jessica" <jfox@acme.example>')
	})

	it('drops an implausible source result instead of sending it', async () => {
		const garbage = new Map([
			['tenant:default', { ...tenantSource, resolve: () => 'not-an-address' } as FromAddressSource],
		])
		expect(
			await resolveSendFrom({
				configured: 'tenant:default',
				sources: garbage,
				sourceArgs: sendArgs,
			})
		).toBe(undefined)
	})

	it('propagates a throwing source', async () => {
		const failing = new Map([
			[
				'tenant:default',
				{
					...tenantSource,
					resolve: () => {
						throw new Error('tenant lookup down')
					},
				} as FromAddressSource,
			],
		])
		await expect(
			resolveSendFrom({ configured: 'tenant:default', sources: failing, sourceArgs: sendArgs })
		).rejects.toThrow('tenant lookup down')
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

	it('serves source entries ahead of resolver options', async () => {
		const result = await resolveFromAddressesRequest({
			isAuthed: true,
			req,
			resolver: () => options,
			sources: { tenant: tenantSource },
		})
		expect(result.status).toBe(200)
		expect('options' in result.body ? result.body.options : []).toEqual([
			{ label: 'Tenant default', value: 'tenant:default' },
			...options,
		])
	})

	it('serves sources alone when no resolver is configured', async () => {
		const result = await resolveFromAddressesRequest({
			isAuthed: true,
			req,
			sources: { tenant: tenantSource },
		})
		expect(result.status).toBe(200)
		expect('options' in result.body ? result.body.options : []).toEqual([
			{ label: 'Tenant default', value: 'tenant:default' },
		])
	})

	it('localizes a per-locale source label by the request language', async () => {
		const localized = { ...tenantSource, label: { en: 'Tenant default', de: 'Mandanten-Standard' } }
		const germanReq = {
			t: (key: string) => key,
			i18n: { language: 'de' },
		} as unknown as PayloadRequest
		const result = await resolveFromAddressesRequest({
			isAuthed: true,
			req: germanReq,
			sources: { tenant: localized },
		})
		expect('options' in result.body ? result.body.options : []).toEqual([
			{ label: 'Mandanten-Standard', value: 'tenant:default' },
		])
	})
})
