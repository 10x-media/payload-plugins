import type { Config, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { registerQueueControl } from './registerQueueControl'

const fakeReq = (user: unknown = null): { req: PayloadRequest } => ({
	req: { user, headers: new Headers() } as unknown as PayloadRequest,
})

const baseConfig = (existingRun?: (args: { req: PayloadRequest }) => boolean): Config =>
	({
		collections: [],
		jobs: existingRun
			? {
					access: { run: existingRun },
				}
			: {},
		globals: [],
	}) as unknown as Config

const baseOptions = {
	access: () => true,
	queues: ['default'],
}

describe('registerQueueControl access.run composition', () => {
	it('sets access.run when no existing run checker is present', () => {
		const config = baseConfig()
		registerQueueControl(config, baseOptions, null)
		expect(typeof config.jobs?.access?.run).toBe('function')
	})

	it('composes with existing run checker: both must pass', async () => {
		const existingRun = vi.fn().mockResolvedValue(true)
		const pluginAccess = vi.fn().mockResolvedValue(true)
		const config = baseConfig(existingRun)
		registerQueueControl(config, { ...baseOptions, access: pluginAccess }, null)

		const run = config.jobs?.access?.run
		expect(run).toBeDefined()
		if (!run) return

		// Both pass -> true
		const result = await run(fakeReq({ id: '1' }))
		expect(result).toBe(true)
		expect(existingRun).toHaveBeenCalledTimes(1)
		expect(pluginAccess).toHaveBeenCalledTimes(1)
	})

	it('composes with existing run checker: plugin checker failing -> false', async () => {
		const existingRun = vi.fn().mockResolvedValue(true)
		const pluginAccess = vi.fn().mockResolvedValue(false)
		const config = baseConfig(existingRun)
		registerQueueControl(config, { ...baseOptions, access: pluginAccess }, null)

		const run = config.jobs?.access?.run
		if (!run) return
		const result = await run(fakeReq({ id: '1' }))
		expect(result).toBe(false)
	})

	it('composes with existing run checker: existing checker failing -> false', async () => {
		const existingRun = vi.fn().mockResolvedValue(false)
		const pluginAccess = vi.fn().mockResolvedValue(true)
		const config = baseConfig(existingRun)
		registerQueueControl(config, { ...baseOptions, access: pluginAccess }, null)

		const run = config.jobs?.access?.run
		if (!run) return
		const result = await run(fakeReq({ id: '1' }))
		expect(result).toBe(false)
	})

	it('enforces the existing run checker on the plugin /queue-run endpoint, not just native /run', async () => {
		// Operator forbids running jobs; the plugin default would allow it. The plugin's own
		// job-executing endpoint must honor the operator's checker, else /run is hardened but
		// /queue-run silently bypasses it.
		const existingRun = vi.fn().mockResolvedValue(false)
		const pluginAccess = vi.fn().mockResolvedValue(true)
		const config = baseConfig(existingRun)
		registerQueueControl(config, { ...baseOptions, access: pluginAccess }, null)

		const overrides = config.jobs?.jobsCollectionOverrides
		if (!overrides) throw new Error('expected jobsCollectionOverrides to be registered')
		const collection = overrides({
			defaultJobsCollection: { endpoints: [] },
		} as unknown as Parameters<typeof overrides>[0])
		const endpoints = Array.isArray(collection.endpoints) ? collection.endpoints : []
		const queueRun = endpoints.find((e) => e.path === '/queue-run')
		expect(queueRun).toBeDefined()
		if (!queueRun || typeof queueRun.handler !== 'function') return

		const req = {
			headers: new Headers(),
			payload: {
				jobs: { handleSchedules: async () => undefined, run: async () => ({}) },
				kv: { get: async () => null, set: async () => undefined },
			},
			query: {},
			user: { id: '1' },
		} as unknown as PayloadRequest
		const res = await queueRun.handler(req)
		expect(res.status).toBe(401)
		expect(existingRun).toHaveBeenCalled()
	})
})
