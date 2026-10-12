import { encryptedField } from '@10x-media/fields/encrypted'
import type { CollectionAfterReadHook, Config, Endpoint } from 'payload'
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

	it('rejects a code subscription header that fetch could not send', () => {
		const withHeaders = (headers: Record<string, string>) => () =>
			webhooks({ subscriptions: [{ id: 'crm', url: 'https://x', events: [], headers }] })(
				fakeConfig()
			)
		expect(withHeaders({ 'X Custom': '1' })).toThrow(/not a valid HTTP header name/)
		expect(withHeaders({ 'X-Trace': 'a\r\nInjected: 1' })).toThrow(/line break/)
		expect(withHeaders({ '  X-Padded  ': '1' })).not.toThrow()
	})

	describe('source collections', () => {
		const withPosts = () => ({ collections: [{ slug: 'posts', fields: [] }] }) as unknown as Config

		/**
		 * A slug with no hook attached never emits, while the subscription form still offers its
		 * events. Without generated types nothing else catches the typo.
		 */
		it('refuses a slug that matches no registered collection', () => {
			expect(() => webhooks({ collections: { psots: true } })(withPosts())).toThrow(
				/'psots'.*never emit/
			)
			expect(() => webhooks({ collections: { posts: true } })(withPosts())).not.toThrow()
		})

		it('refuses its own collections and Payload internals as sources', () => {
			expect(() => webhooks({ collections: { 'webhook-deliveries': true } })(withPosts())).toThrow(
				/cannot emit events/
			)
			expect(() => webhooks({ collections: { 'payload-jobs': true } })(withPosts())).toThrow(
				/cannot emit events/
			)
		})
	})

	describe('delivery.allowedHosts', () => {
		it('refuses a code subscription whose host is not on the list', () => {
			const subscriptions = [{ id: 'crm', url: 'https://crm.elsewhere.test/hook', events: [] }]
			expect(() =>
				webhooks({ subscriptions, delivery: { allowedHosts: ['*.example.com'] } })(fakeConfig())
			).toThrow(/code subscription 'crm'.*allowedHosts/)
			expect(() => webhooks({ subscriptions })(fakeConfig())).not.toThrow()
		})

		it('refuses a list entry that is a url rather than a hostname', () => {
			expect(() =>
				webhooks({ delivery: { allowedHosts: ['https://hooks.example.com'] } })(fakeConfig())
			).toThrow(/is not a hostname/)
		})

		it('refuses a list entry that is a url rather than a hostname', () => {
			expect(() =>
				webhooks({ delivery: { allowedHosts: ['https://hooks.example.com'] } })(fakeConfig())
			).toThrow(/is not a hostname/)
		})
	})

	it('refuses a retention window that is not a positive number of days', () => {
		for (const retentionDays of [0, -1, Number.NaN]) {
			expect(() => webhooks({ deliveriesLog: { retentionDays } })(fakeConfig())).toThrow(
				/retentionDays/
			)
		}
		expect(() => webhooks({ deliveriesLog: { retentionDays: 30 } })(fakeConfig())).not.toThrow()
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

		const paths = (endpoints: unknown) =>
			(Array.isArray(endpoints) ? (endpoints as Endpoint[]) : []).map((e) => e.path)
		const mine: Endpoint = { path: '/mine', method: 'get', handler: () => new Response() }

		/**
		 * `endpoints` is an ordinary collection key, so a plain spread would let the override
		 * replace the plugin's own and leave the Rotate and Redeliver buttons calling a 404.
		 */
		it('adds override endpoints to the plugin endpoints instead of replacing them', () => {
			const find = built({
				subscriptionsCollection: { overrides: { endpoints: [mine] } },
				deliveriesLog: { overrides: { endpoints: [mine] } },
			})
			expect(paths(find('webhook-subscriptions')?.endpoints)).toEqual([
				'/:id/rotate-secret',
				'/mine',
			])
			expect(paths(find('webhook-deliveries')?.endpoints)).toEqual(['/:id/redeliver', '/mine'])
		})

		it('keeps the plugin endpoint ahead of a consumer route on the same path', () => {
			const shadow: Endpoint = { ...mine, path: '/:id/rotate-secret', method: 'post' }
			const find = built({ subscriptionsCollection: { overrides: { endpoints: [shadow] } } })
			const [first] = find('webhook-subscriptions')?.endpoints as Endpoint[]
			expect(first?.path).toBe('/:id/rotate-secret')
			expect(first?.handler).not.toBe(shadow.handler)
		})

		it('leaves endpoints: false alone, and offers no control for an endpoint that is off', () => {
			const find = built({ subscriptionsCollection: { overrides: { endpoints: false } } })
			const subscriptions = find('webhook-subscriptions')
			expect(subscriptions?.endpoints).toBe(false)
			expect(subscriptions?.admin?.components?.edit?.beforeDocumentControls ?? []).toEqual([])
		})

		it('keeps the document controls when an override sets admin.components', () => {
			const find = built({
				subscriptionsCollection: {
					overrides: {
						admin: { components: { edit: { beforeDocumentControls: ['/host#Control'] } } },
					},
				},
			})
			expect(
				find('webhook-subscriptions')?.admin?.components?.edit?.beforeDocumentControls
			).toEqual(['/host#Control', '@10x-media/webhooks/client#RotateSecretButton'])
			expect(find('webhook-deliveries')?.admin?.components?.edit?.beforeDocumentControls).toEqual([
				'@10x-media/webhooks/client#RedeliverButton',
			])
		})

		/**
		 * The response strip scans the fields it is handed, so it has to run after the override
		 * or a write-only field a consumer adds would be returned sealed on every read.
		 */
		it('strips a write-only field a consumer adds through overrides.fields', () => {
			const find = built({
				subscriptionsCollection: {
					overrides: {
						fields: ({ defaultFields }) => [
							...defaultFields,
							...encryptedField({ name: 'apiKey', type: 'text' }, { protection: 'writeOnly' }),
						],
					},
				},
			})
			const hooks = (find('webhook-subscriptions')?.hooks?.afterRead ??
				[]) as CollectionAfterReadHook[]
			const doc = { apiKey: 'sealed', name: 'crm', secret: 'sealed' }
			for (const hook of hooks) {
				hook({ context: {}, doc } as never)
			}
			expect(doc).toEqual({ name: 'crm' })
		})

		it('keeps the slug, which the task and endpoints are already wired to', () => {
			const find = built({
				subscriptionsCollection: { overrides: { slug: 'elsewhere' } as never },
			})
			expect(find('webhook-subscriptions')).toBeDefined()
			expect(find('elsewhere')).toBeUndefined()
		})
	})

	/**
	 * The secret editor comes from `@10x-media/fields`, whose strings its own plugin registers. A
	 * host that installs only this plugin would otherwise see raw keys in the admin.
	 */
	it('registers the encrypted editor strings, and lets the host override them', () => {
		const translationsOf = (config: Config) =>
			(webhooks({})(config) as Config).i18n?.translations as Record<
				string,
				Record<string, Record<string, string>>
			>
		expect(translationsOf(fakeConfig()).en?.fields?.generateValue).toBe('Generate new value')
		expect(translationsOf(fakeConfig()).de?.fields?.generateValue).toBeTruthy()

		const hosted = {
			collections: [],
			i18n: { translations: { en: { fields: { generateValue: 'Make one' } } } },
		} as unknown as Config
		expect(translationsOf(hosted).en?.fields?.generateValue).toBe('Make one')
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
