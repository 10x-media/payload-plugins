import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { defineAction } from '../../src/actions/defineAction'
import type { FormEvent, FormEventSink } from '../../src/events/types'
import { formBuilder } from '../../src/index'

describeForDb('form-builder submission status bypass prevention', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	const runs: number[] = []
	const events: FormEvent[] = []

	const recorder = defineAction({
		type: 'recorder',
		label: 'Recorder',
		run: () => {
			runs.push(1)
		},
	})

	const sink: FormEventSink = { emit: (e) => void events.push(e) }

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({ actions: { recorder }, events: sink }), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('forces status to complete even when the client sends partial, and still runs actions', async () => {
		runs.length = 0
		events.length = 0
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Status test',
				fields: [{ blockType: 'text', name: 'name', label: 'Name' }],
				actions: [{ blockType: 'recorder' }],
			},
		})
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			// A client cannot bypass the post-submit pipeline by sending status:'partial'.
			// validateSubmission forces it to 'complete' server-side.
			data: { form: form.id, values: [{ field: 'name', value: 'Ada' }], status: 'partial' },
		})

		expect(submission.status).toBe('complete')

		await vi.waitFor(() => {
			expect(runs.length).toBeGreaterThan(0)
		})
		expect(events.some((e) => e.type === 'submission.created')).toBe(true)
	})

	it('a normal submission without explicit status is also complete', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Normal',
				fields: [{ blockType: 'text', name: 'name', label: 'Name' }],
			},
		})
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			data: { form: form.id, values: [{ field: 'name', value: 'Grace' }] },
		})
		expect(submission.status).toBe('complete')
	})
})
