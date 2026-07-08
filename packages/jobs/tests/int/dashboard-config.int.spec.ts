import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Field, TaskConfig, WorkflowConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { jobs } from '../../src/index'

const fieldByName = (fields: Field[], name: string): Field | undefined =>
	fields.find((f) => 'name' in f && f.name === name)

const sendEmailTask: TaskConfig<'sendEmail'> = {
	slug: 'sendEmail',
	handler: () => ({ output: {} }),
}

const syncCrmTask: TaskConfig<'syncCrm'> = {
	slug: 'syncCrm',
	handler: () => ({ output: {} }),
}

const onboardingWorkflow: WorkflowConfig<'onboarding'> = {
	slug: 'onboarding',
	handler: () => {},
}

describeForDb('jobs dashboard config', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({ queueControl: { queues: ['default', 'emails'] }, reliability: true }),
			db,
			configOverrides: {
				jobs: {
					tasks: [sendEmailTask, syncCrmTask],
					workflows: [onboardingWorkflow],
				},
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('puts jobTitle first in default columns as a linked cell', () => {
		const cfg = booted.payload.collections['payload-jobs']?.config
		expect(cfg?.admin?.defaultColumns?.[0]).toBe('jobTitle')
		expect(cfg?.admin?.useAsTitle).toBe('jobTitle')
		const title = cfg && fieldByName(cfg.fields, 'jobTitle')
		expect(title?.admin?.components?.Cell).toBeDefined()
	})

	it('keeps jobTitle out of the edit form via a false condition', () => {
		const cfg = booted.payload.collections['payload-jobs']?.config
		const title = cfg && fieldByName(cfg.fields, 'jobTitle')
		expect(title?.admin?.condition).toBeTypeOf('function')
		expect(
			title?.admin?.condition?.(
				{},
				{},
				{ blockData: {}, operation: 'update', path: [], user: null }
			)
		).toBe(false)
	})

	it('keeps waitUntil in the form on edit with the schedule field component', () => {
		const cfg = booted.payload.collections['payload-jobs']?.config
		const waitUntil = cfg && fieldByName(cfg.fields, 'waitUntil')
		expect(waitUntil?.admin?.condition).toBeUndefined()
		expect(waitUntil?.admin?.components?.Field).toBeDefined()
	})
})
