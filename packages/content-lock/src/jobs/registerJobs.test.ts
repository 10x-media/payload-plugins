import type { InterruptClassifier } from '@10x-media/jobs'
import type { Config, Payload, PayloadRequest } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { assertContentUnlocked } from '../enforcement/assertUnlocked'
import { ContentLockedError } from '../enforcement/ContentLockedError'
import { CUSTOM_KEY, resolveOptions } from '../options'
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

describe('a job the lock interrupts', () => {
	const NOW = new Date('2026-01-10T10:00:00.000Z')

	afterEach(() => {
		vi.useRealTimers()
	})

	const classifier = (): InterruptClassifier => {
		const jobs = registry()
		const config = { custom: { '@10x-media/jobs': jobs } } as unknown as Config
		registerJobsIntegration(config, undefined, true)
		return jobs.extensions.interruptOn[0] as InterruptClassifier
	}

	it('runs again a minute after the lock state could not be read, not a day', async () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		vi.setSystemTime(NOW)
		const payload = {
			config: { custom: { [CUSTOM_KEY]: resolveOptions({}) } },
			kv: { get: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) },
			logger: { error: vi.fn() },
		} as unknown as Payload
		const req = { context: {}, payload } as unknown as PayloadRequest
		const unreadable = await assertContentUnlocked(req, { collection: 'posts' }).catch(
			(error: unknown) => error
		)
		const classify = classifier()
		expect(classify({ error: unreadable, payload })).toEqual({
			by: 'content-lock:unknown',
			until: new Date(NOW.getTime() + 60_000),
		})
		const manualEnd = new ContentLockedError('locked', { endsAt: null, lockIds: ['w1'] })
		expect(classify({ error: manualEnd, payload })).toEqual({
			by: 'content-lock:w1',
			until: new Date(NOW.getTime() + 24 * 60 * 60_000),
		})
	})
})
