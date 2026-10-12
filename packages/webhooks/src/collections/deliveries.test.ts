import { describe, expect, it } from 'vitest'
import { buildDeliveriesCollection } from './deliveries'

const find = (c: ReturnType<typeof buildDeliveriesCollection>, name: string) =>
	c.fields.find((f) => 'name' in f && f.name === name)

/** Access arguments for a request by `user`, on a config whose admin collection is `users`. */
const as = (user: unknown) =>
	({ req: { payload: { config: { admin: { user: 'users' } } }, user } }) as never

describe('buildDeliveriesCollection', () => {
	const c = buildDeliveriesCollection({ slug: 'webhook-deliveries', hidden: false })

	it('uses the slug and is admin-read-only', () => {
		expect(c.slug).toBe('webhook-deliveries')
		expect(c.access?.create?.({} as never)).toBe(false)
		expect(c.access?.update?.({} as never)).toBe(false)
		expect(c.access?.read?.(as(undefined))).toBe(false)
		expect(c.access?.read?.(as({ collection: 'users', id: '1' }))).toBe(true)
		expect(c.access?.delete?.(as(undefined))).toBe(false)
	})

	/**
	 * The log stores the full body of every document a watched collection emitted, so "any
	 * logged-in user" would hand it to every account in a second auth collection.
	 */
	it('refuses a logged-in user of a collection other than the admin one', () => {
		expect(c.access?.read?.(as({ collection: 'customers', id: '1' }))).toBe(false)
		expect(c.access?.delete?.(as({ collection: 'customers', id: '1' }))).toBe(false)
	})

	it('wires the status cell and stores the payload', () => {
		const status = find(c, 'status')
		expect(status && 'admin' in status ? status.admin?.components?.Cell : undefined).toBe(
			'@10x-media/webhooks/client#DeliveryStatusCell'
		)
		expect(find(c, 'payload')?.type).toBe('json')
	})
})
