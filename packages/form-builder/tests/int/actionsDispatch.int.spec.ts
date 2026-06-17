import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { defineAction } from '../../src/actions/defineAction'
import type { FormEvent, FormEventSink } from '../../src/events/types'
import { formBuilder } from '../../src/index'

type RecordedRun = { formId: number | string; submissionId: number | string; values: number }

describeForDb('form-builder action dispatch', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	const runs: RecordedRun[] = []
	const events: FormEvent[] = []

	const recorder = defineAction({
		type: 'recorder',
		label: 'Recorder',
		run: ({ form, submissionId, values }) => {
			runs.push({ formId: form.id, submissionId, values: values.length })
		},
	})

	const boom = defineAction({
		type: 'boom',
		label: 'Boom',
		run: () => {
			throw new Error('action exploded')
		},
	})

	const sink: FormEventSink = {
		emit: (event) => {
			events.push(event)
		},
	}

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({ actions: { recorder, boom }, events: sink }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('runs the form actions inline and emits submission.created', async () => {
		runs.length = 0
		events.length = 0
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Contact',
				fields: [{ blockType: 'text', name: 'fullName', label: 'Full name', required: true }],
				actions: [{ blockType: 'recorder' }],
			},
		})
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			data: { form: form.id, values: [{ field: 'fullName', value: 'Ada' }] },
		})

		await vi.waitFor(() => {
			expect(runs).toHaveLength(1)
		})
		expect(runs[0]).toEqual({ formId: form.id, submissionId: submission.id, values: 1 })

		await vi.waitFor(() => {
			expect(events.some((e) => e.type === 'submission.created')).toBe(true)
		})
		const created = events.find((e) => e.type === 'submission.created')
		expect(created).toMatchObject({
			type: 'submission.created',
			formId: String(form.id),
			submissionId: String(submission.id),
		})
	})

	it('still succeeds and emits when an action throws', async () => {
		runs.length = 0
		events.length = 0
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Throwing',
				fields: [{ blockType: 'text', name: 'fullName', label: 'Full name', required: true }],
				actions: [{ blockType: 'boom' }],
			},
		})

		const submission = await booted.payload.create({
			collection: 'form-submissions',
			data: { form: form.id, values: [{ field: 'fullName', value: 'Grace' }] },
		})
		expect(submission.id).toBeDefined()

		await vi.waitFor(() => {
			expect(events.some((e) => e.type === 'submission.created')).toBe(true)
		})
		const created = events.find((e) => e.type === 'submission.created')
		expect(created).toMatchObject({
			type: 'submission.created',
			submissionId: String(submission.id),
		})
	})

	it('does not throw for a legacy submission whose form has no actions field', async () => {
		runs.length = 0
		events.length = 0
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'No actions',
				fields: [{ blockType: 'text', name: 'fullName', label: 'Full name', required: true }],
			},
		})
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			data: { form: form.id, values: [{ field: 'fullName', value: 'Lin' }] },
		})
		expect(submission.id).toBeDefined()
		expect(runs).toHaveLength(0)
		await vi.waitFor(() => {
			expect(events.some((e) => e.type === 'submission.created')).toBe(true)
		})
	})
})
