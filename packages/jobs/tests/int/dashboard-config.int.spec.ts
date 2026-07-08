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

	it('keeps workflow and task selects over every configured slug, and queue as text with a select component', () => {
		const cfg = booted.payload.collections['payload-jobs']?.config
		const optionValues = (field: Field | undefined) =>
			field?.type === 'select'
				? field.options.map((o) => (typeof o === 'object' ? o.value : o))
				: undefined
		const workflow = cfg && fieldByName(cfg.fields, 'workflowSlug')
		expect(workflow?.type).toBe('select')
		expect(optionValues(workflow)).toEqual(['onboarding'])
		expect(workflow?.admin?.condition).toBeTypeOf('function')
		const task = cfg && fieldByName(cfg.fields, 'taskSlug')
		expect(task?.type).toBe('select')
		expect(optionValues(task)).toEqual(['inline', 'sendEmail', 'syncCrm'])
		expect(task?.admin?.condition).toBeTypeOf('function')
		const queue = cfg && fieldByName(cfg.fields, 'queue')
		expect(queue?.type).toBe('text')
		expect(queue?.admin?.components?.Field).toBeDefined()
	})

	it('rejects creating a job with both a workflow and a task', async () => {
		await expect(
			booted.payload.create({
				collection: 'payload-jobs',
				data: { taskSlug: 'sendEmail', workflowSlug: 'onboarding' } as never,
			})
		).rejects.toThrow(/workflow or a task/)
	})

	it('still accepts programmatic queue names outside any configured list', async () => {
		const job = await booted.payload.create({
			collection: 'payload-jobs',
			data: { queue: 'not-in-options', taskSlug: 'sendEmail' } as never,
		})
		expect(job.queue).toBe('not-in-options')
	})
})

describeForDb('jobs collection override seam', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({
				overrides: {
					jobs: {
						admin: { group: 'Ops' },
						fields: ({ defaultFields }) => [...defaultFields, { name: 'costCenter', type: 'text' }],
					},
				},
				reliability: true,
			}),
			db,
			configOverrides: { jobs: { tasks: [sendEmailTask] } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('applies consumer fields over the fully-enhanced defaults', () => {
		const cfg = booted.payload.collections['payload-jobs']?.config
		expect(cfg?.admin?.group).toBe('Ops')
		expect(cfg && fieldByName(cfg.fields, 'costCenter')).toBeDefined()
		expect(cfg && fieldByName(cfg.fields, 'leaseExpiresAt')).toBeDefined()
		expect(cfg && fieldByName(cfg.fields, 'jobTitle')).toBeDefined()
	})
})
