import type { Config, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { registerQueueControl } from './registerQueueControl'

const fakeReq = (user: unknown = null): { req: PayloadRequest } => ({
	req: { user, headers: new Headers() } as unknown as PayloadRequest,
})

const baseConfig = (existingRun?: (args: { req: PayloadRequest }) => boolean): Config => ({
	collections: [],
	jobs: existingRun
		? {
				access: { run: existingRun },
			}
		: {},
	globals: [],
})

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
})
