import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { defineAction } from '../../src/actions/defineAction'
import { formBuilder } from '../../src/index'

describeForDb('form-builder access: actions field', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let formId: string | number

	const noop = defineAction({
		type: 'noop',
		label: 'Noop',
		config: [{ name: 'secret', type: 'text', label: 'Secret' }],
		run: () => {},
	})

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({ actions: { noop } }), db })
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Webhook Test',
				fields: [{ blockType: 'text', name: 'name', label: 'Name' }],
				actions: [{ blockType: 'noop', secret: 'top-secret-value' }],
			},
		})
		formId = form.id
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('an authenticated read returns the actions with content', async () => {
		const form = await booted.payload.findByID({
			collection: 'forms',
			id: formId,
			overrideAccess: false,
			req: { user: { id: 1, collection: 'users' } } as never,
		})
		expect(Array.isArray(form.actions)).toBe(true)
		expect((form.actions as unknown[]).length).toBeGreaterThan(0)
	})

	it('an anonymous read returns the form fields but strips action content', async () => {
		const form = await booted.payload.findByID({
			collection: 'forms',
			id: formId,
			overrideAccess: false,
		})
		// Public form rendering needs fields/flow — they must be present.
		expect(Array.isArray(form.fields)).toBe(true)
		// Action config (which may include secrets) is stripped for anonymous callers.
		// Payload returns [] (not undefined) for a blocks field with read access denied.
		const actions = form.actions as unknown[]
		expect(Array.isArray(actions) && actions.length === 0).toBe(true)
	})
})
