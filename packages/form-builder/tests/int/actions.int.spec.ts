import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
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
				fields: [],
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

	it('stores a form with no actions', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: { title: 'No actions', fields: [] },
		})

		expect(form.actions).toBeDefined()
	})
})
