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

describeForDb('form-builder essential actions', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	const delivered: string[] = []
	let providerDown = false

	const subscribe = defineAction({
		type: 'subscribe',
		label: 'Subscribe',
		essential: true,
		run: ({ values }) => {
			if (providerDown) {
				throw new Error('provider rejected')
			}
			delivered.push(String(values.find((v) => v.field === 'email')?.value))
		},
	})

	const recorder = defineAction({
		type: 'recorder',
		label: 'Recorder',
		run: () => {
			delivered.push('recorder')
		},
	})

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({ actions: { subscribe, recorder } }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const makeForm = () =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Newsletter',
				persistSubmissions: false,
				fields: [{ blockType: 'email', name: 'email', label: 'Email' }],
				actions: [{ blockType: 'subscribe' }, { blockType: 'recorder' }],
			},
		})

	/** Drive the root POST endpoint the way a browser submit would (custom endpoint first). */
	const submitViaRest = async (formId: number | string, email: string) => {
		const endpoints = booted.payload.collections['form-submissions']?.config.endpoints
		const endpoint = (Array.isArray(endpoints) ? endpoints : []).find(
			(entry) => entry.method === 'post' && entry.path === '/'
		)
		if (!endpoint) throw new Error('no root POST endpoint registered')
		const { createLocalReq } = await import('payload')
		const req = await createLocalReq({}, booted.payload)
		req.data = { form: formId, values: [{ field: 'email', value: email }] }
		req.routeParams = { collection: 'form-submissions' }
		const response = await endpoint.handler(req)
		return { status: response.status, body: (await response.json()) as Record<string, unknown> }
	}

	const submissionCount = async (formId: number | string) =>
		(
			await booted.payload.count({
				collection: 'form-submissions',
				where: { form: { equals: formId } },
			})
		).totalDocs

	it('delivers, prunes, and returns 201 when the essential action succeeds', async () => {
		delivered.length = 0
		providerDown = false
		const form = await makeForm()
		const { status } = await submitViaRest(form.id, 'ada@example.com')
		expect(status).toBe(201)
		expect(delivered).toContain('ada@example.com')
		await vi.waitFor(async () => {
			expect(await submissionCount(form.id)).toBe(0)
			expect(delivered).toContain('recorder')
		})
	})

	it('fails the response, keeps the row, and skips the rest when the provider rejects', async () => {
		delivered.length = 0
		providerDown = true
		try {
			const form = await makeForm()
			const { status, body } = await submitViaRest(form.id, 'lost@example.com')
			expect(status).toBeGreaterThanOrEqual(500)
			const message = (body.errors as { message?: string }[] | undefined)?.[0]?.message
			expect(message).toBeTruthy()
			expect(delivered).toEqual([])
			// Kept despite persistSubmissions: false, so the address is recoverable by an operator.
			expect(await submissionCount(form.id)).toBe(1)
		} finally {
			providerDown = false
		}
	})
})
