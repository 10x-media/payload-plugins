import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { pollConfigOf } from '../../src/form/pollState'
import { formBuilder } from '../../src/index'
import { definePollOptionSource } from '../../src/poll/definePollOptionSource'

type Outcome = { winningValues?: string[]; resolvedAt?: string | null } | undefined

const outcomeOf = (poll: unknown): Outcome => (pollConfigOf(poll)?.outcome ?? undefined) as Outcome

/** Run a rejected write and return the first field error message, or throw if it unexpectedly resolves. */
const errorMessageOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
	try {
		await promise
	} catch (error) {
		return (error as { data?: { errors?: { message?: string }[] } }).data?.errors?.[0]?.message
	}
	throw new Error('expected the write to be rejected')
}

const colourField = {
	blockType: 'select',
	name: 'colour',
	label: 'Colour',
	options: [
		{ label: 'Red', value: 'red' },
		{ label: 'Blue', value: 'blue' },
	],
}

describeForDb('form-builder poll vote-field binding', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const create = (data: Record<string, unknown>) =>
		booted.payload.create({ collection: 'forms', data: { title: 'Poll', ...data } })

	it('defaults an enabled poll to the mostVoted outcome type', async () => {
		const form = await create({
			fields: [colourField],
			pollEnabled: true,
			poll: { resultsField: 'colour' },
		})
		expect(pollConfigOf(form.poll)?.type).toBe('mostVoted')
	})

	it('auto-fills the vote field from the sole choice field on the form', async () => {
		const form = await create({
			fields: [colourField, { blockType: 'text', name: 'note', label: 'Note' }],
			pollEnabled: true,
		})
		expect(pollConfigOf(form.poll)?.resultsField).toBe('colour')
	})

	it('requires the author to choose when several choice fields could be the vote field', async () => {
		const message = await errorMessageOf(
			create({
				fields: [
					colourField,
					{
						blockType: 'select',
						name: 'size',
						label: 'Size',
						options: [
							{ label: 'S', value: 's' },
							{ label: 'L', value: 'l' },
						],
					},
				],
				pollEnabled: true,
			})
		)
		expect(message).toBe("Choose which field's answers count as votes.")
	})

	it('guards an enabled poll that has no choice field to vote on', async () => {
		const message = await errorMessageOf(
			create({
				fields: [{ blockType: 'text', name: 'note', label: 'Note' }],
				pollEnabled: true,
			})
		)
		expect(message).toBe('Add a choice field to use as the poll question.')
	})

	it('leaves a non-poll form untouched even with no choice field', async () => {
		const form = await create({ fields: [{ blockType: 'text', name: 'note', label: 'Note' }] })
		expect(form.id).toBeDefined()
		expect(pollConfigOf(form.poll)?.resultsField ?? '').toBe('')
	})

	// The save-through Close button saves the whole document: an admin's just-picked winner and the new
	// closesAt persist together through one update, exactly as `submit({ overrides: { poll } })` does.
	it('persists an unsaved winner and closesAt together on a manual close, then reopens clearing both', async () => {
		const form = await create({
			fields: [colourField],
			pollEnabled: true,
			poll: { resultsField: 'colour', type: 'manual' },
		})

		const closesAt = new Date().toISOString()
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: {
				poll: {
					resultsField: 'colour',
					type: 'manual',
					closesAt,
					outcome: { winningValues: ['red'] },
				},
			},
			overrideAccess: true,
		})
		const closed = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
		expect(pollConfigOf(closed.poll)?.closesAt).toBe(closesAt)
		expect(outcomeOf(closed.poll)?.winningValues).toEqual(['red'])
		expect(outcomeOf(closed.poll)?.resolvedAt).toBeTruthy()

		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: {
				poll: {
					resultsField: 'colour',
					type: 'manual',
					closesAt: null,
					outcome: { winningValues: [] },
				},
			},
			overrideAccess: true,
		})
		const reopened = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
		expect(pollConfigOf(reopened.poll)?.closesAt ?? null).toBeNull()
		expect(outcomeOf(reopened.poll)?.winningValues ?? []).toEqual([])
		expect(outcomeOf(reopened.poll)?.resolvedAt ?? null).toBeNull()
	})
})

describeForDb('form-builder poll vote-field source exemption', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	const athletes = definePollOptionSource({
		type: 'athletes',
		label: 'Athletes',
		resolve: () => [{ label: 'Ada', value: 'ada' }],
	})

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({ poll: { sources: { athletes } } }), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const winnerField = { blockType: 'select', name: 'winner', label: 'Winner', options: [] }

	it('exempts a source-type poll from the vote-field requirement', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Source poll',
				fields: [winnerField],
				pollEnabled: true,
				poll: { type: 'source' },
			},
		})
		expect(pollConfigOf(form.poll)?.type).toBe('source')
		expect(pollConfigOf(form.poll)?.resultsField ?? '').toBe('')
	})

	it('exempts an optionSource poll from the vote-field requirement', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Sourced poll',
				fields: [winnerField],
				pollEnabled: true,
				poll: { optionSource: 'athletes' },
			},
		})
		expect(pollConfigOf(form.poll)?.optionSource).toBe('athletes')
		expect(pollConfigOf(form.poll)?.resultsField ?? '').toBe('')
	})
})
