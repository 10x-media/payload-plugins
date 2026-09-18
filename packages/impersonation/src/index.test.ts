import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { impersonation } from './index'
import { keys } from './translations'
import type { ImpersonationPluginOptions } from './types'

const fakeConfig = (): Config =>
	({
		admin: { user: 'users' },
		collections: [{ auth: true, fields: [], slug: 'users' }],
	}) as unknown as Config

const allowAll = { access: { impersonate: () => true } } satisfies ImpersonationPluginOptions

describe('impersonation factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof impersonation(allowAll)).toBe('function')
	})

	it('throws when access.impersonate is missing', () => {
		expect(() => impersonation({} as ImpersonationPluginOptions)(fakeConfig())).toThrow(
			/access.impersonate must be a function/
		)
	})

	it('returns the incoming config when disabled', () => {
		const cfg = fakeConfig()
		expect(impersonation({ disabled: true })(cfg)).toBe(cfg)
	})

	it('applies the translations option', () => {
		const out = impersonation({
			...allowAll,
			translations: { de: { [keys.pluginName]: 'Beispiel' } },
		})(fakeConfig()) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.impersonation?.pluginName).toBe('Beispiel')
		expect(i18n.en?.impersonation?.pluginName).toBe('Impersonation')
	})

	it('registers the records collection and root endpoints', () => {
		const out = impersonation(allowAll)(fakeConfig()) as Config
		expect(
			out.collections?.some((collection) => collection.slug === 'impersonation-sessions')
		).toBe(true)
		const paths = (out.endpoints ?? []).map((endpoint) => `${endpoint.method} ${endpoint.path}`)
		expect(paths).toEqual(
			expect.arrayContaining([
				'post /impersonation/start',
				'post /impersonation/exit',
				'get /impersonation',
				'post /impersonation/:id/end',
			])
		)
	})
})
