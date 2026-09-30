import type { Config, Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { registerJobsIntegration } from './registerJobs'

const registry = () => ({
	api: { resumeDeferred: vi.fn() },
	extensions: { interruptOn: [] as unknown[], runGates: [] as unknown[] },
	plan: { defer: [], heartbeat: null },
})

describe('registerJobsIntegration', () => {
	it('registers a gate and a classifier with the jobs plugin', () => {
		const jobs = registry()
		const config = { custom: { '@10x-media/jobs': jobs } } as unknown as Config
		expect(registerJobsIntegration(config, undefined, true)).toBe(true)
		expect(jobs.extensions.runGates).toHaveLength(1)
		expect(jobs.extensions.interruptOn).toHaveLength(1)
	})

	it('stays off with `jobs: false`', () => {
		const jobs = registry()
		const config = { custom: { '@10x-media/jobs': jobs } } as unknown as Config
		expect(registerJobsIntegration(config, false, true)).toBe(false)
		expect(jobs.extensions.runGates).toHaveLength(0)
	})

	it('warns at init when `jobs` is set without the jobs plugin', async () => {
		const config = {} as Config
		expect(registerJobsIntegration(config, { queues: ['sync'] }, false)).toBe(false)
		const warn = vi.fn()
		await config.onInit?.({ logger: { warn } } as unknown as Payload)
		expect(warn).toHaveBeenCalledOnce()
	})

	it('says nothing without the jobs plugin when `jobs` is not set', () => {
		const config = {} as Config
		registerJobsIntegration(config, undefined, false)
		expect(config.onInit).toBeUndefined()
	})
})
