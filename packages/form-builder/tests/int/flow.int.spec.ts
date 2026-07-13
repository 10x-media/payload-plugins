import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

describeForDb('form-builder flow normalization', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stores a valid 2-step flow with transitions intact', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Multi-step with transition',
				fields: [
					{ blockType: 'text', name: 'name', label: 'Name' },
					{ blockType: 'text', name: 'email', label: 'Email' },
				],
				flow: {
					steps: [
						{
							id: 'step-a',
							title: 'Your name',
							fields: ['name'],
							transitions: [{ when: { name: { equals: 'skip' } }, to: 'step-b' }],
							next: 'step-b',
						},
						{
							id: 'step-b',
							fields: ['email'],
						},
					],
				},
			},
		})

		const flow = form.flow as Record<string, unknown> | null | undefined
		expect(flow).toBeTruthy()
		const steps = flow?.steps as unknown[]
		expect(steps).toHaveLength(2)
		const stepA = steps[0] as Record<string, unknown>
		expect(stepA.id).toBe('step-a')
		expect(stepA.title).toBe('Your name')
		expect(stepA.fields).toEqual(['name'])
		expect(stepA.next).toBe('step-b')
		const transitions = stepA.transitions as Array<Record<string, unknown>>
		expect(transitions).toHaveLength(1)
		expect(transitions[0]?.to).toBe('step-b')
		expect(transitions[0]?.when).toEqual({ name: { equals: 'skip' } })
		const stepB = steps[1] as Record<string, unknown>
		expect(stepB.id).toBe('step-b')
		expect(stepB.fields).toEqual(['email'])
	})

	it('rejects a single-step flow instead of silently discarding it', async () => {
		await expect(
			booted.payload.create({
				collection: 'forms',
				data: {
					title: 'Single-step flow',
					fields: [{ blockType: 'text', name: 'name', label: 'Name' }],
					flow: { steps: [{ id: 'only', fields: ['name'] }] },
				},
			})
		).rejects.toThrow()
	})

	it('rejects a flow whose steps collapse to fewer than two unique ids', async () => {
		await expect(
			booted.payload.create({
				collection: 'forms',
				data: {
					title: 'Duplicate-id flow',
					fields: [
						{ blockType: 'text', name: 'name', label: 'Name' },
						{ blockType: 'text', name: 'email', label: 'Email' },
					],
					flow: {
						steps: [
							{ id: 'dup', fields: ['name'] },
							{ id: 'dup', fields: ['email'] },
						],
					},
				},
			})
		).rejects.toThrow()
	})

	it('drops ghost fields, bad transition targets, and bad default next', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Flow with bad refs',
				fields: [
					{ blockType: 'text', name: 'name', label: 'Name' },
					{ blockType: 'text', name: 'email', label: 'Email' },
				],
				flow: {
					steps: [
						{
							id: 'step-a',
							fields: ['name', 'ghost'],
							transitions: [
								{ when: { name: { equals: 'x' } }, to: 'nowhere' },
								{ when: { name: { equals: 'y' } }, to: 'step-b' },
							],
							next: 'nonexistent',
						},
						{
							id: 'step-b',
							fields: ['email'],
						},
					],
				},
			},
		})

		const flow = form.flow as Record<string, unknown> | null | undefined
		expect(flow).toBeTruthy()
		const steps = flow?.steps as unknown[]
		expect(steps).toHaveLength(2)
		const stepA = steps[0] as Record<string, unknown>
		expect(stepA.fields).toEqual(['name'])
		const transitions = stepA.transitions as Array<Record<string, unknown>>
		expect(transitions).toHaveLength(1)
		expect(transitions[0]?.to).toBe('step-b')
		expect(stepA.next).toBeUndefined()
	})
})
