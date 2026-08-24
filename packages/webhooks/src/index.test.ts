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

	it('rejects a code subscription that sets Content-Type, which the pipeline owns too', () => {
		expect(() =>
			webhooks({
				subscriptions: [
					{ id: 'crm', url: 'https://x', events: [], headers: { 'Content-Type': 'text/plain' } },
				],
			})(fakeConfig())
		).toThrow(/reserved header/)
	})

	describe('collection overrides', () => {
		const built = (options: Parameters<typeof webhooks>[0]) => {
			const out = webhooks(options)(fakeConfig()) as Config
			return (slug: string) => out.collections?.find((c) => c.slug === slug)
		}

		it('merges access key by key, so an override need not restate the rest', () => {
			const deny = () => false
			const find = built({ subscriptionsCollection: { overrides: { access: { update: deny } } } })
			const subscriptions = find('webhook-subscriptions')
			expect(subscriptions?.access?.update).toBe(deny)
			expect(typeof subscriptions?.access?.read).toBe('function')
		})

		it('composes fields through the default-fields function', () => {
			const find = built({
				deliveriesLog: {
					overrides: {
						fields: ({ defaultFields }) => [
							...defaultFields,
							{ name: 'tenant', type: 'text' } as never,
						],
					},
				},
			})
			const fields = find('webhook-deliveries')?.fields ?? []
			expect(fields.some((f) => 'name' in f && f.name === 'tenant')).toBe(true)
			expect(fields.length).toBeGreaterThan(1)
		})

		it('keeps the slug, which the task and endpoints are already wired to', () => {
			const find = built({
				subscriptionsCollection: { overrides: { slug: 'elsewhere' } as never },
			})
			expect(find('webhook-subscriptions')).toBeDefined()
			expect(find('elsewhere')).toBeUndefined()
		})
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
