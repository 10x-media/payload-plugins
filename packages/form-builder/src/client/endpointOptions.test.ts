import { describe, expect, it } from 'vitest'
import { buildEndpointOptionsUrl, parseEndpointOptions } from './endpointOptions'

describe('buildEndpointOptionsUrl', () => {
	it('joins the api route, collection, id, and endpoint', () => {
		expect(
			buildEndpointOptionsUrl({
				apiRoute: '/api',
				collectionSlug: 'forms',
				id: 7,
				endpoint: 'poll-options',
			})
		).toBe('/api/forms/7/poll-options')
	})

	it('accepts a leading slash on the endpoint and encodes the id', () => {
		expect(
			buildEndpointOptionsUrl({
				apiRoute: '/api',
				collectionSlug: 'forms',
				id: 'a/b c',
				endpoint: '/poll-options',
			})
		).toBe('/api/forms/a%2Fb%20c/poll-options')
	})

	it('rejects a document-scoped build without an id instead of encoding undefined', () => {
		expect(() =>
			buildEndpointOptionsUrl({
				apiRoute: '/api',
				collectionSlug: 'forms',
				endpoint: 'poll-options',
			})
		).toThrow(/document-scoped/)
		expect(() =>
			buildEndpointOptionsUrl({
				apiRoute: '/api',
				collectionSlug: 'forms',
				scope: 'document',
				endpoint: 'poll-options',
			})
		).toThrow(/document-scoped/)
	})

	it('omits the id segment for a request-scoped endpoint, with or without an id', () => {
		expect(
			buildEndpointOptionsUrl({
				apiRoute: '/api',
				collectionSlug: 'forms',
				scope: 'request',
				endpoint: 'from-addresses',
			})
		).toBe('/api/forms/from-addresses')
		expect(
			buildEndpointOptionsUrl({
				apiRoute: '/api',
				collectionSlug: 'forms',
				scope: 'request',
				id: 7,
				endpoint: 'from-addresses',
			})
		).toBe('/api/forms/from-addresses')
	})
})

describe('parseEndpointOptions', () => {
	it('returns the options with labels falling back to values', () => {
		expect(
			parseEndpointOptions({
				options: [{ label: 'Ada', value: 'ada' }, { value: 'grace' }],
			})
		).toEqual([
			{ label: 'Ada', value: 'ada' },
			{ label: 'grace', value: 'grace' },
		])
	})

	it('skips entries without a string value', () => {
		expect(parseEndpointOptions({ options: [{ label: 'broken' }, null, { value: 'ok' }] })).toEqual(
			[{ label: 'ok', value: 'ok' }]
		)
	})

	it('throws on a malformed body', () => {
		expect(() => parseEndpointOptions(null)).toThrow(/malformed/i)
		expect(() => parseEndpointOptions({})).toThrow(/malformed/i)
		expect(() => parseEndpointOptions({ options: 'nope' })).toThrow(/malformed/i)
	})
})
