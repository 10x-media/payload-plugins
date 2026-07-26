import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { signFormContext } from '../../src/context/formContext'
import { formBuilder } from '../../src/index'
import { CONTEXT_KEY } from '../../src/spam/constants'

describeForDb('form-builder context + persistSubmissions', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const makeForm = (data: Record<string, unknown> = {}) =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Contact',
				fields: [{ blockType: 'text', name: 'name', label: 'Name' }],
				...data,
			},
		})

	const submit = (formId: number | string, values: { field: string; value: unknown }[]) =>
		booted.payload.create({ collection: 'form-submissions', data: { form: formId, values } })

	it('verifies a signed context, stores it, and keeps it out of the answers', async () => {
		const form = await makeForm()
		const token = signFormContext({ payload: booted.payload, relationTo: 'forms', value: form.id })
		const submission = await submit(form.id, [
			{ field: 'name', value: 'Jo' },
			{ field: CONTEXT_KEY, value: token },
		])
		expect(submission.context).toEqual({ relationTo: 'forms', value: String(form.id) })
		const values = submission.values as { field: string }[]
		expect(values.some((entry) => entry.field === CONTEXT_KEY)).toBe(false)
		expect(values.map((entry) => entry.field)).toEqual(['name'])
	})

	it('rejects an invalid context instead of dropping it', async () => {
		const form = await makeForm()
		await expect(submit(form.id, [{ field: CONTEXT_KEY, value: 'v1.bad.sig' }])).rejects.toThrow()
	})

	it('submits normally with no context', async () => {
		const form = await makeForm()
		const submission = await submit(form.id, [{ field: 'name', value: 'Jo' }])
		// A group always materializes; "no context" means an unpopulated reference, not an absent field.
		expect((submission.context as { relationTo?: string } | undefined)?.relationTo).toBeFalsy()
	})

	it('prunes a submission when the form opts out of persistence', async () => {
		const form = await makeForm({ persistSubmissions: false })
		const submission = await submit(form.id, [{ field: 'name', value: 'Jo' }])
		const found = await booted.payload
			.findByID({ collection: 'form-submissions', id: submission.id })
			.catch(() => null)
		expect(found).toBeNull()
	})

	it('keeps a submission when the form persists', async () => {
		const form = await makeForm({ persistSubmissions: true })
		const submission = await submit(form.id, [{ field: 'name', value: 'Jo' }])
		const found = await booted.payload
			.findByID({ collection: 'form-submissions', id: submission.id })
			.catch(() => null)
		expect(found?.id).toBe(submission.id)
	})
})
