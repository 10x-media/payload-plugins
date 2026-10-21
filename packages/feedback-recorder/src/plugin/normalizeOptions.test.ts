import type { Config, Payload, TypedUser } from 'payload'
import { describe, expect, it } from 'vitest'

import { normalizeOptions } from './normalizeOptions'

const config = (extra: Partial<Config> = {}) =>
	({ admin: { user: 'users' }, collections: [], globals: [], ...extra }) as Pick<
		Config,
		'admin' | 'collections' | 'globals'
	>

const asUser = (collection: string) => ({ collection, id: '1' }) as unknown as TypedUser
const payload = { config: { admin: { user: 'users' } } } as unknown as Payload

describe('normalizeOptions', () => {
	it('is configured only with both url and key', () => {
		expect(normalizeOptions({ url: 'https://a.example' }, config()).configured).toBe(false)
		expect(normalizeOptions({ apiKey: 'rec_x' }, config()).configured).toBe(false)
		expect(
			normalizeOptions({ url: 'https://a.example/', apiKey: ' rec_x ' }, config())
		).toMatchObject({ configured: true, url: 'https://a.example', apiKey: 'rec_x' })
	})

	it('treats blank env values as missing', () => {
		expect(normalizeOptions({ url: '  ', apiKey: '' }, config())).toMatchObject({
			url: null,
			apiKey: null,
			configured: false,
		})
	})

	it('refuses a url that is not http(s)', () => {
		expect(() => normalizeOptions({ url: 'not a url' }, config())).toThrow(/absolute URL/)
		expect(() => normalizeOptions({ url: 'ftp://a.example' }, config())).toThrow(/http or https/)
	})

	it('normalizes the api path and refuses a collision', () => {
		expect(normalizeOptions({ apiPath: 'recorder/' }, config()).apiPath).toBe('/recorder')
		expect(() =>
			normalizeOptions(
				{ apiPath: '/media' },
				config({ collections: [{ slug: 'media', fields: [] }] })
			)
		).toThrow(/collides/)
		expect(() => normalizeOptions({ apiPath: '/' }, config())).toThrow(/plain path/)
	})

	it('defaults access to the admin user collection', async () => {
		const { access } = normalizeOptions({}, config())
		expect(await access({ payload, user: asUser('users') })).toBe(true)
		expect(await access({ payload, user: asUser('hcp-users') })).toBe(false)
	})

	it('refuses a non-function access', () => {
		expect(() => normalizeOptions({ access: true as unknown as () => boolean }, config())).toThrow(
			/access must be a function/
		)
	})

	it('keeps console capture off unless asked', () => {
		expect(normalizeOptions({}, config()).captureConsole).toBe(false)
		expect(normalizeOptions({ captureConsole: true }, config()).captureConsole).toBe(true)
	})
})
