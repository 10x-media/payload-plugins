import { describe, expect, it } from 'vitest'
import { buildDeliveriesCollection } from './deliveries'

const find = (c: ReturnType<typeof buildDeliveriesCollection>, name: string) =>
	c.fields.find((f) => 'name' in f && f.name === name)

describe('buildDeliveriesCollection', () => {
	const c = buildDeliveriesCollection({ slug: 'webhook-deliveries', hidden: false })

	it('uses the slug and is admin-read-only', () => {
		expect(c.slug).toBe('webhook-deliveries')
		expect(c.access?.create?.({} as never)).toBe(false)
		expect(c.access?.update?.({} as never)).toBe(false)
		expect(c.access?.read?.({ req: {} } as never)).toBe(false)
		expect(c.access?.read?.({ req: { user: { id: '1' } } } as never)).toBe(true)
		expect(c.access?.delete?.({ req: {} } as never)).toBe(false)
	})

	it('wires the status cell and stores the payload', () => {
		const status = find(c, 'status')
		expect(status && 'admin' in status ? status.admin?.components?.Cell : undefined).toBe(
			'@10x-media/webhooks/client#DeliveryStatusCell'
		)
		expect(find(c, 'payload')?.type).toBe('json')
	})
})
