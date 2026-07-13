import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { formBuilder } from '../../src/index'

describeForDb('form-builder actions storage', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stores a form with an emailTeam action block', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Contact',
				fields: [],
				actions: [
					{
						blockType: 'emailTeam',
						to: 'team@x.com',
						subject: 'New submission',
						body: 'A submission arrived.',
					},
				],
			},
		})

		expect(Array.isArray(form.actions)).toBe(true)
		expect(form.actions).toHaveLength(1)
		const action = form.actions[0] as Record<string, unknown>
		expect(action.blockType).toBe('emailTeam')
		expect(action.to).toBe('team@x.com')
	})

	it('stores multiple action blocks of different types', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Multi-action',
				fields: [{ blockType: 'email', name: 'email', label: 'Email' }],
				actions: [
					{ blockType: 'emailTeam', to: 'ops@x.com', subject: 'Alert', body: '' },
					{ blockType: 'confirmation', toField: 'email', subject: 'Thanks', body: 'Got it.' },
				],
			},
		})

		expect(form.actions).toHaveLength(2)
		const types = (form.actions as Array<Record<string, unknown>>).map((a) => a.blockType)
		expect(types).toEqual(['emailTeam', 'confirmation'])
	})

	it('rejects a confirmation toField that names no field on the form', async () => {
		await expect(
			booted.payload.create({
				collection: 'forms',
				data: {
					title: 'Unknown toField',
					fields: [],
					actions: [
						{ blockType: 'confirmation', toField: 'nope', subject: 'Thanks', body: 'Got it.' },
					],
				},
			})
		).rejects.toThrow()
	})

	it('rejects a confirmation toField that names a non-email field', async () => {
		await expect(
			booted.payload.create({
				collection: 'forms',
				data: {
					title: 'Non-email toField',
					fields: [{ blockType: 'text', name: 'name', label: 'Name' }],
					actions: [
						{ blockType: 'confirmation', toField: 'name', subject: 'Thanks', body: 'Got it.' },
					],
				},
			})
		).rejects.toThrow()
	})

	it('accepts a confirmation toField that names a real email field', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Valid toField',
				fields: [{ blockType: 'email', name: 'email', label: 'Email' }],
				actions: [
					{ blockType: 'confirmation', toField: 'email', subject: 'Thanks', body: 'Got it.' },
				],
			},
		})

		const action = form.actions?.[0] as Record<string, unknown>
		expect(action.toField).toBe('email')
	})

	it('rejects a signedWebhook url that is not a valid http(s) URL', async () => {
		await expect(
			booted.payload.create({
				collection: 'forms',
				data: {
					title: 'Invalid webhook url',
					fields: [],
					actions: [{ blockType: 'signedWebhook', url: 'not-a-url', secret: 'shh' }],
				},
			})
		).rejects.toThrow()
	})

	it('accepts a signedWebhook url that is a valid https URL', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Valid webhook url',
				fields: [],
				actions: [{ blockType: 'signedWebhook', url: 'https://example.com/hook', secret: 'shh' }],
			},
		})

		const action = form.actions?.[0] as Record<string, unknown>
		expect(action.url).toBe('https://example.com/hook')
	})

	it('stores a form with no actions', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: { title: 'No actions', fields: [] },
		})

		expect(form.actions).toBeDefined()
	})

	it('sends a lexical body as serialized, interpolated HTML', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		booted.payload.sendEmail = sendEmail as typeof booted.payload.sendEmail

		const body = {
			root: {
				type: 'root',
				children: [
					{
						type: 'paragraph',
						children: [{ type: 'text', text: 'Hi {{name}}', format: 1 }],
					},
					{ type: 'paragraph', children: [{ type: 'text', text: '{{*}}' }] },
				],
			},
		}

		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Rich body',
				fields: [{ blockType: 'text', name: 'name', label: 'Full name' }],
				actions: [{ blockType: 'emailTeam', to: 'team@x.com', subject: 'From {{name}}', body }],
			},
		})

		await booted.payload.create({
			collection: 'form-submissions',
			data: { form: form.id, values: [{ field: 'name', value: 'Ada & Bo' }] },
		})

		await vi.waitFor(() => {
			expect(sendEmail).toHaveBeenCalledOnce()
		})
		expect(sendEmail).toHaveBeenCalledWith({
			to: 'team@x.com',
			subject: 'From Ada & Bo',
			html: '<p><strong>Hi Ada &amp; Bo</strong></p><p>Full name: Ada &amp; Bo</p>',
		})
	})

	it('keeps sending legacy string bodies interpolated and unchanged', async () => {
		const sendEmail = vi.fn().mockResolvedValue(undefined)
		booted.payload.sendEmail = sendEmail as typeof booted.payload.sendEmail

		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Legacy body',
				fields: [{ blockType: 'text', name: 'name', label: 'Full name' }],
				actions: [
					{ blockType: 'emailTeam', to: 'team@x.com', subject: 'Alert', body: 'From {{name}}' },
				],
			},
		})

		await booted.payload.create({
			collection: 'form-submissions',
			data: { form: form.id, values: [{ field: 'name', value: 'Ada & Bo' }] },
		})

		await vi.waitFor(() => {
			expect(sendEmail).toHaveBeenCalledOnce()
		})
		expect(sendEmail).toHaveBeenCalledWith({
			to: 'team@x.com',
			subject: 'Alert',
			html: 'From Ada & Bo',
		})
	})
})
