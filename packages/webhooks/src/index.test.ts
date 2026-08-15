import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { webhooks } from './index'
import { keys } from './translations'

const fakeConfig = () => ({ collections: [] }) as unknown as Config

describe('webhooks factory', () => {
	it('returns a Payload plugin function', () => {
		expect(typeof webhooks({})).toBe('function')
	})

	it('rejects a code subscription whose secret is not usable whsec_ material', () => {
		expect(() =>
			webhooks({ subscriptions: [{ id: 'crm', url: 'https://x', events: [], secret: 'nope!' }] })(
				fakeConfig()
			)
		).toThrow(/code subscription 'crm'/)
	})

	it('rejects a code subscription that sets a reserved header', () => {
		expect(() =>
			webhooks({
				subscriptions: [
					{ id: 'crm', url: 'https://x', events: [], headers: { 'Webhook-Id': 'mine' } },
				],
			})(fakeConfig())
		).toThrow(/reserved header/)
	})

	it('applies the translations option', () => {
		const out = webhooks({ translations: { de: { [keys.pluginName]: 'Webhooks (DE)' } } })(
			fakeConfig()
		) as Config
		const i18n = out.i18n?.translations as Record<string, Record<string, Record<string, string>>>
		expect(i18n.de?.webhooks?.pluginName).toBe('Webhooks (DE)')
		expect(i18n.en?.webhooks?.pluginName).toBe('Webhooks')
	})
})
