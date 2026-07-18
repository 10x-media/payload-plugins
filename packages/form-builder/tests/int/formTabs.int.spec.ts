import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Condition, Field } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

/** Payload types the third condition argument as always present; these read only the first two. */
const props = {} as Parameters<Condition>[2]

describeForDb('form-builder form-type tabs', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	// Read the condition off the booted (sanitized) config to prove sanitizeConfig keeps it intact.
	const tabConditionByField = (fieldName: string): Condition => {
		const fields = booted.payload.collections.forms?.config.fields ?? []
		const tabs = fields.find((f): f is Extract<Field, { type: 'tabs' }> => f.type === 'tabs')
		const tab = tabs?.tabs.find((t) => t.fields.some((f) => 'name' in f && f.name === fieldName))
		const condition = (tab?.admin as { condition?: Condition } | undefined)?.condition
		if (typeof condition !== 'function') {
			throw new Error(`missing admin.condition on the tab containing ${fieldName}`)
		}
		return condition
	}

	it('hides the Flow tab unless multistep is true', () => {
		const flow = tabConditionByField('flow')
		expect(flow({}, { multistep: true }, props)).toBe(true)
		expect(flow({}, { multistep: false }, props)).toBe(false)
		expect(flow({}, {}, props)).toBe(false)
	})

	it('hides the Poll tab unless pollEnabled is true', () => {
		const poll = tabConditionByField('poll')
		expect(poll({}, { pollEnabled: true }, props)).toBe(true)
		expect(poll({}, { pollEnabled: false }, props)).toBe(false)
		expect(poll({}, {}, props)).toBe(false)
	})

	it('lets both flags coexist so the Flow and Poll tabs show together', () => {
		const flow = tabConditionByField('flow')
		const poll = tabConditionByField('poll')
		const both = { multistep: true, pollEnabled: true }
		expect(flow({}, both, props)).toBe(true)
		expect(poll({}, both, props)).toBe(true)
	})

	it('still validates outcome membership on a pollEnabled form with the flag hoisted to the root', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Coexist',
				multistep: true,
				pollEnabled: true,
				fields: [
					{
						blockType: 'select',
						name: 'winner',
						label: 'Winner',
						options: [
							{ label: 'Ada', value: 'ada' },
							{ label: 'Grace', value: 'grace' },
						],
					},
				],
				poll: { resultsField: 'winner' },
			},
		})

		let message: string | undefined
		try {
			await booted.payload.update({
				collection: 'forms',
				id: form.id,
				data: { poll: { outcome: { winningValue: 'zorro' } } },
				overrideAccess: true,
			})
			throw new Error('expected the outcome write to be rejected')
		} catch (error) {
			message = (error as { data?: { errors?: { message?: string }[] } }).data?.errors?.[0]?.message
		}
		expect(message).toBe('The winning value must be one of the poll options.')

		const updated = await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: { poll: { outcome: { winningValue: 'ada' } } },
			overrideAccess: true,
		})
		const outcome = (updated.poll as { outcome?: { winningValue?: string; resolvedAt?: string } })
			.outcome
		expect(outcome?.winningValue).toBe('ada')
		expect(outcome?.resolvedAt).toBeTruthy()
	})
})
