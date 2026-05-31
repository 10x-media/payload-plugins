import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { TaskConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { jobs } from '../../src/index'

/**
 * Payload only materializes the built-in `payload-jobs` collection when the host
 * configures at least one task or workflow. The jobs plugin enhances that
 * collection, so the test supplies a minimal task to bring it into existence.
 */
const noopTask: TaskConfig<'noop'> = {
	slug: 'noop',
	handler: () => ({ output: {} }),
}

describeForDb('jobs loads', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({}),
			db,
			configOverrides: { jobs: { tasks: [noopTask] } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('payload boots with the plugin loaded', () => {
		expect(booted.payload).toBeDefined()
		expect(booted.db).toBe(db)
	})

	it('keeps the built-in payload-jobs collection', () => {
		expect(booted.payload.collections['payload-jobs']).toBeDefined()
	})

	it('registers the jobs collection override seam', () => {
		expect(booted.payload.config.jobs?.jobsCollectionOverrides).toBeTypeOf('function')
	})

	it('enhances the payload-jobs collection with the jobTitle document title', () => {
		expect(booted.payload.collections['payload-jobs']?.config.admin?.useAsTitle).toBe('jobTitle')
	})
})
