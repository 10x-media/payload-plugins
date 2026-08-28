import type { Config, Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import type { ResolvedSSEOptions } from '../options'
import { registerSSE } from './registerSSE'

const resolvedOptions = (broker: ResolvedSSEOptions['broker']): ResolvedSSEOptions => ({
	collections: {},
	presence: undefined,
	admin: undefined,
	heartbeatMs: 15_000,
	broker,
	translations: undefined,
})

describe('registerSSE', () => {
	it('wraps payload.destroy to tear down broker before the previous destroy', async () => {
		const order: string[] = []
		const broker = {
			publish: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			destroy: vi.fn(async () => {
				order.push('broker')
			}),
		}
		const prevDestroy = vi.fn(async () => {
			order.push('prevDestroy')
		})
		const payload = { destroy: prevDestroy } as unknown as Payload
		const prevOnInit = vi.fn(async () => {
			order.push('prevOnInit')
		})
		const config = { onInit: prevOnInit } as unknown as Config

		registerSSE({ config, options: resolvedOptions(broker) })

		expect(config.onInit).not.toBe(prevOnInit)
		if (!config.onInit) {
			throw new Error('expected wrapped onInit')
		}
		await config.onInit(payload)

		expect(prevOnInit).toHaveBeenCalledWith(payload)
		expect(order).toEqual(['prevOnInit'])

		await payload.destroy()

		expect(broker.destroy).toHaveBeenCalledOnce()
		expect(prevDestroy).toHaveBeenCalledOnce()
		expect(order).toEqual(['prevOnInit', 'broker', 'prevDestroy'])
	})
})
