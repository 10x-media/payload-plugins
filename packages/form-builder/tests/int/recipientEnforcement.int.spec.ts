import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DepartmentOption } from '../../src/email/departments'
import { formBuilder } from '../../src/index'

let departmentsCalls = 0
const departments = async (): Promise<DepartmentOption[]> => {
	departmentsCalls++
	return [{ label: 'Sales', value: 'sales@x.com' }]
}

describeForDb('form-builder recipient enforcement', { dbs: ['mongo'] }, (db) => {
	describe('with email.recipients.allowCustom false', () => {
		let booted: BootedPayload

		beforeAll(async () => {
			booted = await bootPayload({
				plugin: formBuilder({ email: { departments, recipients: { allowCustom: false } } }),
				db,
			})
		})

		afterAll(async () => {
			await booted.stop()
		})

		const createTeam = (over: Record<string, unknown>) =>
			booted.payload.create({
				collection: 'forms',
				data: {
					title: 'Team',
					fields: [],
					actions: [{ blockType: 'emailTeam', subject: 'S', body: 'B', ...over }],
				},
			})

		it('saves a listed department address', async () => {
			const form = await createTeam({ to: ['sales@x.com'] })
			const action = (form.actions as Record<string, unknown>[])[0]
			expect(action?.to).toEqual(['sales@x.com'])
		})

		it('rejects an off-list address', async () => {
			await expect(createTeam({ to: ['stranger@x.com'] })).rejects.toThrow()
		})

		it('resolves departments once per save despite multiple recipient fields', async () => {
			departmentsCalls = 0
			await createTeam({ to: ['sales@x.com'], cc: ['sales@x.com'], bcc: ['sales@x.com'] })
			expect(departmentsCalls).toBe(1)
		})
	})

	describe('with allowCustom default (true)', () => {
		let booted: BootedPayload

		beforeAll(async () => {
			booted = await bootPayload({ plugin: formBuilder({ email: { departments } }), db })
		})

		afterAll(async () => {
			await booted.stop()
		})

		it('saves any valid email', async () => {
			const form = await booted.payload.create({
				collection: 'forms',
				data: {
					title: 'Team',
					fields: [],
					actions: [{ blockType: 'emailTeam', to: ['anyone@x.com'], subject: 'S', body: 'B' }],
				},
			})
			const action = (form.actions as Record<string, unknown>[])[0]
			expect(action?.to).toEqual(['anyone@x.com'])
		})
	})
})
