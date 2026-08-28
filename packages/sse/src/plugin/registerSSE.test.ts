import type { Config, Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import type { ResolvedSSEOptions } from '../options'
import { registerSSE } from './registerSSE'

const resolvedOptions = (broker: ResolvedSSEOptions['broker']): ResolvedSSEOptions => ({
	collections: {},
	presence: false,
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
		const payload = {
			destroy: prevDestroy,
			kv: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
		} as unknown as Payload
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

	it('registers presence POST and DELETE only when presence is enabled', () => {
		const offConfig = {} as Config
		registerSSE({ config: offConfig, options: resolvedOptions(undefined) })
		const offPaths = (offConfig.endpoints ?? []).map((e) => `${e.method}:${e.path}`)
		expect(offPaths).toContain('get:/realtime/stream')
		expect(offPaths).not.toContain('post:/realtime/presence')
		expect(offPaths).not.toContain('delete:/realtime/presence')

		const onConfig = {} as Config
		registerSSE({
			config: onConfig,
			options: {
				...resolvedOptions(undefined),
				presence: {
					heartbeatMs: 10_000,
					leaseMs: 30_000,
					identify: (user) => ({
						id: String((user as { id: unknown }).id),
						label: String((user as { id: unknown }).id),
					}),
				},
			},
		})
		const onPaths = (onConfig.endpoints ?? []).map((e) => `${e.method}:${e.path}`)
		expect(onPaths).toContain('post:/realtime/presence')
		expect(onPaths).toContain('delete:/realtime/presence')
	})
})
