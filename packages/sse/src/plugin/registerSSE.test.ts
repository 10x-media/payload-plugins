import type { Config, Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { InProcessBroker } from '../broker/InProcessBroker'
import type { ResolvedSSEOptions } from '../options'
import { registerSSE } from './registerSSE'

const resolvedOptions = (broker: ResolvedSSEOptions['broker']): ResolvedSSEOptions => ({
	collections: {},
	presence: false,
	admin: undefined,
	heartbeatMs: 15_000,
	maxConnectionsPerUser: 8,
	broker,
	translations: undefined,
	scope: false,
})

describe('registerSSE', () => {
	it('does not destroy a host-supplied broker on payload.destroy', async () => {
		const broker = {
			publish: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			destroy: vi.fn(async () => {}),
		}
		const prevDestroy = vi.fn(async () => {})
		const payload = {
			destroy: prevDestroy,
			kv: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
		} as unknown as Payload
		const config = {} as Config

		registerSSE({ config, options: resolvedOptions(broker) })
		if (!config.onInit) {
			throw new Error('expected wrapped onInit')
		}
		await config.onInit(payload)
		await payload.destroy()

		expect(broker.destroy).not.toHaveBeenCalled()
		expect(prevDestroy).toHaveBeenCalledOnce()
	})

	it('destroys an InProcessBroker the plugin created on payload.destroy', async () => {
		const destroySpy = vi.spyOn(InProcessBroker.prototype, 'destroy').mockResolvedValue(undefined)
		const prevDestroy = vi.fn(async () => {})
		const payload = {
			destroy: prevDestroy,
			kv: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
		} as unknown as Payload
		const config = {} as Config

		registerSSE({ config, options: resolvedOptions(undefined) })
		if (!config.onInit) {
			throw new Error('expected wrapped onInit')
		}
		await config.onInit(payload)
		await payload.destroy()

		expect(destroySpy).toHaveBeenCalledOnce()
		expect(prevDestroy).toHaveBeenCalledOnce()
		destroySpy.mockRestore()
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
