import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import {
	consentSourcesOf,
	resolveConsentEntries,
	stashConsentSources,
} from './resolveConsentEntries'
import type { ConsentSourceEntry, ConsentSourcesResolver } from './types'

const payloadWith = (custom: Record<string, unknown> | undefined) =>
	({ config: { custom } }) as unknown as Payload

const makeReq = () => ({ context: {} }) as unknown as PayloadRequest

const entries: ConsentSourceEntry[] = [{ id: 'privacy', name: 'Privacy' }]
const form = { id: 'form-1', title: 'Contact' }

describe('stashConsentSources / consentSourcesOf', () => {
	it('round-trips the resolver, keeping unrelated custom keys', () => {
		const resolver: ConsentSourcesResolver = () => entries
		const custom = stashConsentSources({ other: 1 }, resolver)
		expect(custom.other).toBe(1)
		expect(consentSourcesOf(payloadWith(custom))).toBe(resolver)
	})

	it('shares its slice with the poll registry rather than overwriting it', () => {
		const resolver: ConsentSourcesResolver = () => entries
		const custom = stashConsentSources(
			{ '@10x-media/form-builder': { pollOptionSources: 'x' } },
			resolver
		)
		expect(custom['@10x-media/form-builder']).toEqual({
			pollOptionSources: 'x',
			consentSources: resolver,
		})
	})

	it('is undefined when the plugin never stashed one', () => {
		expect(consentSourcesOf(payloadWith(undefined))).toBeUndefined()
		expect(consentSourcesOf(payloadWith({}))).toBeUndefined()
	})
})

describe('resolveConsentEntries', () => {
	it('returns what the host resolver gives for the request', async () => {
		const sources = vi.fn().mockResolvedValue(entries)
		const req = makeReq()
		const result = await resolveConsentEntries({ payload: payloadWith({}), req, form, sources })
		expect(result).toBe(entries)
		expect(sources).toHaveBeenCalledWith({ req, form: { id: 'form-1', title: 'Contact' } })
	})

	it('falls back to the resolver the plugin stashed on the config', async () => {
		const sources = vi.fn().mockResolvedValue(entries)
		const payload = payloadWith(stashConsentSources(undefined, sources))
		expect(await resolveConsentEntries({ payload, req: makeReq(), form })).toBe(entries)
	})

	it('returns no entries when no resolver is configured', async () => {
		expect(await resolveConsentEntries({ payload: payloadWith({}), req: makeReq(), form })).toEqual(
			[]
		)
	})

	it('resolves once per request and form, however many consent fields ask', async () => {
		const sources = vi.fn().mockResolvedValue(entries)
		const req = makeReq()
		await resolveConsentEntries({ payload: payloadWith({}), req, form, sources })
		await resolveConsentEntries({ payload: payloadWith({}), req, form, sources })
		expect(sources).toHaveBeenCalledTimes(1)
	})

	it('caches per form, not across them', async () => {
		const sources = vi.fn().mockResolvedValue(entries)
		const req = makeReq()
		await resolveConsentEntries({ payload: payloadWith({}), req, form, sources })
		await resolveConsentEntries({ payload: payloadWith({}), req, form: { id: 'form-2' }, sources })
		expect(sources).toHaveBeenCalledTimes(2)
	})

	it('forwards the whole form document to the resolver, not just id and title', async () => {
		const sources = vi.fn().mockResolvedValue(entries)
		const req = makeReq()
		// A variable (not an inline literal) so the extra `tenant` field is not excess-property-checked;
		// the resolver reads non-standard fields off the whole doc at runtime and casts for their types.
		const form = { id: 'form-1', title: 'Contact', tenant: 'acme' }
		await resolveConsentEntries({ payload: payloadWith({}), req, form, sources })
		expect(sources).toHaveBeenCalledWith({ req, form })
	})

	it('forwards a null title now that the whole doc passes through', async () => {
		const sources = vi.fn().mockResolvedValue(entries)
		await resolveConsentEntries({
			payload: payloadWith({}),
			req: makeReq(),
			form: { id: 'form-1', title: null },
			sources,
		})
		expect(sources).toHaveBeenCalledWith({
			req: expect.anything(),
			form: { id: 'form-1', title: null },
		})
	})

	it('propagates a resolver failure, leaving the caller to fail closed', async () => {
		const sources = vi.fn().mockRejectedValue(new Error('tenant lookup down'))
		await expect(
			resolveConsentEntries({ payload: payloadWith({}), req: makeReq(), form, sources })
		).rejects.toThrow('tenant lookup down')
	})
})
