import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import {
	type CollectionConfig,
	type Condition,
	createLocalReq,
	type Field,
	type SelectField,
} from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildFormsCollection } from '../../src/collections/forms'
import { buildDefaultFieldDefinitions } from '../../src/fields/builtin'
import { resolveFieldTypes } from '../../src/fields/registry'
import { isPollClosed, pollConfigOf } from '../../src/form/pollState'
import { formBuilder } from '../../src/index'
import { definePollOptionSource } from '../../src/poll/definePollOptionSource'
import { resolvePollOptionSources } from '../../src/poll/registry'
import { resolvePollCloseRequest } from '../../src/poll/resolvePollCloseRequest'
import { resolvePollOutcome } from '../../src/poll/resolvePollOutcome'
import { defaultValidationRules } from '../../src/validation/builtin'
import { resolveValidationRules } from '../../src/validation/registry'

/** Payload types the third condition argument as always present; these read only the first two. */
const props = {} as Parameters<Condition>[2]

type Outcome = { winningValues?: string[]; resolvedAt?: string } | undefined

const pollGroupFields = (collection: CollectionConfig): Field[] => {
	const tabs = collection.fields.find((f) => f.type === 'tabs')
	const pollTab =
		tabs?.type === 'tabs'
			? tabs.tabs.find((t) => t.fields.some((f) => 'name' in f && f.name === 'poll'))
			: undefined
	const poll = pollTab?.fields.find((f) => 'name' in f && f.name === 'poll') as
		| Extract<Field, { type: 'group' }>
		| undefined
	if (!poll) {
		throw new Error('poll group missing')
	}
	return poll.fields
}

const buildCollection = (withSource: boolean): CollectionConfig => {
	const source = definePollOptionSource({ type: 'athletes', label: 'Athletes', resolve: () => [] })
	return buildFormsCollection({
		registry: resolveFieldTypes(buildDefaultFieldDefinitions(true)),
		ruleRegistry: resolveValidationRules(defaultValidationRules),
		...(withSource ? { pollSourceRegistry: resolvePollOptionSources({ athletes: source }) } : {}),
	})
}

describe('form-builder poll close field config', () => {
	it('offers the source outcome type only when option sources are registered', () => {
		const optionValues = (collection: CollectionConfig): string[] => {
			const type = pollGroupFields(collection).find(
				(f): f is SelectField => 'name' in f && f.name === 'type'
			)
			return (type?.options ?? []).map((option) =>
				typeof option === 'string' ? option : option.value
			)
		}
		expect(optionValues(buildCollection(false))).toEqual(['manual', 'mostVoted'])
		expect(optionValues(buildCollection(true))).toContain('source')
	})

	it('hides winningValues for a mostVoted poll only', () => {
		const outcome = pollGroupFields(buildCollection(false)).find(
			(f): f is Extract<Field, { type: 'group' }> => 'name' in f && f.name === 'outcome'
		)
		const winning = outcome?.fields.find((f) => 'name' in f && f.name === 'winningValues')
		const condition = (winning?.admin as { condition?: Condition } | undefined)?.condition
		if (typeof condition !== 'function') {
			throw new Error('winningValues admin.condition missing')
		}
		expect(condition({ poll: { type: 'mostVoted' } }, {}, props)).toBe(false)
		expect(condition({ poll: { type: 'manual' } }, {}, props)).toBe(true)
		expect(condition({ poll: { type: 'source' } }, {}, props)).toBe(true)
		expect(condition({}, {}, props)).toBe(true)
	})

	it('shows the close button only when no closesAt is set', () => {
		const closePoll = pollGroupFields(buildCollection(false)).find(
			(f) => 'name' in f && f.name === 'closePoll'
		)
		expect(closePoll && 'type' in closePoll && closePoll.type).toBe('ui')
		const condition = (closePoll?.admin as { condition?: Condition } | undefined)?.condition
		if (typeof condition !== 'function') {
			throw new Error('closePoll admin.condition missing')
		}
		expect(condition({}, {}, props)).toBe(true)
		expect(condition({}, { closesAt: new Date().toISOString() }, props)).toBe(false)
	})
})

describeForDb('form-builder poll close endpoint', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const makePoll = async (over: Record<string, unknown> = {}) =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Colour poll',
				fields: [
					{
						blockType: 'select',
						name: 'colour',
						label: 'Colour',
						options: [
							{ label: 'Red', value: 'red' },
							{ label: 'Blue', value: 'blue' },
						],
					},
				],
				pollEnabled: true,
				poll: { resultsField: 'colour', ...over },
			},
		})

	const vote = async (formId: number | string, value: string) =>
		booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: { form: formId, values: [{ field: 'colour', value }] },
		})

	const outcomeOf = async (formId: number | string): Promise<Outcome> => {
		const doc = await booted.payload.findByID({ collection: 'forms', id: formId, depth: 0 })
		return (doc.poll as { outcome?: NonNullable<Outcome> }).outcome
	}

	const closedAtOf = async (formId: number | string): Promise<string | null | undefined> => {
		const doc = await booted.payload.findByID({ collection: 'forms', id: formId, depth: 0 })
		return pollConfigOf(doc.poll)?.closesAt
	}

	const closeReq = async (formId: number | string | undefined, isAuthed: boolean) => {
		const req = await createLocalReq({}, booted.payload)
		return resolvePollCloseRequest({ payload: booted.payload, formId, isAuthed, req })
	}

	it('refuses an anonymous caller with 403', async () => {
		const form = await makePoll({ type: 'mostVoted' })
		const res = await closeReq(form.id, false)
		expect(res.status).toBe(403)
		expect(await closedAtOf(form.id)).toBeFalsy()
	})

	it('refuses closing a manual poll with no winner recorded (400)', async () => {
		const form = await makePoll({ type: 'manual' })
		await vote(form.id, 'red')
		const res = await closeReq(form.id, true)
		expect(res.status).toBe(400)
		expect('errors' in res.body && res.body.errors[0]?.message).toBe(
			'Set a winner before closing the poll.'
		)
		expect(await closedAtOf(form.id)).toBeFalsy()
	})

	it('closes a manual poll that has a winner and marks it closed', async () => {
		const form = await makePoll({ type: 'manual' })
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: { poll: { outcome: { winningValues: ['red'] } } },
			overrideAccess: true,
		})
		const res = await closeReq(form.id, true)
		expect(res.status).toBe(200)
		const doc = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
		expect(isPollClosed(pollConfigOf(doc.poll))).toBe(true)
		expect((await outcomeOf(form.id))?.winningValues).toEqual(['red'])
	})

	it('closes a mostVoted poll, auto-resolving the winner and stamping closesAt', async () => {
		const form = await makePoll({ type: 'mostVoted' })
		await vote(form.id, 'red')
		await vote(form.id, 'red')
		await vote(form.id, 'blue')
		const res = await closeReq(form.id, true)
		expect(res.status).toBe(200)
		expect('winningValues' in res.body && res.body.winningValues).toEqual(['red'])
		expect(await closedAtOf(form.id)).toBeTruthy()
		expect((await outcomeOf(form.id))?.winningValues).toEqual(['red'])
	})

	it('is idempotent: refuses to re-close an already-closed poll (400)', async () => {
		const form = await makePoll({ type: 'mostVoted' })
		await vote(form.id, 'blue')
		expect((await closeReq(form.id, true)).status).toBe(200)
		const res = await closeReq(form.id, true)
		expect(res.status).toBe(400)
	})

	it('returns 404 for an unknown form and 400 for a missing id', async () => {
		expect((await closeReq(999999, true)).status).toBe(404)
		expect((await closeReq(undefined, true)).status).toBe(400)
	})

	// The condition hides winningValues in the admin; this proves the auto-resolved winner also survives
	// a full-document save that omits it, so hiding it never strands the recorded outcome.
	it('keeps auto-resolved winningValues through a full-doc save that omits them (outcome omitted)', async () => {
		const form = await makePoll({ type: 'mostVoted' })
		await vote(form.id, 'red')
		await vote(form.id, 'red')
		await vote(form.id, 'blue')
		await resolvePollOutcome({ payload: booted.payload, formId: form.id })
		expect((await outcomeOf(form.id))?.winningValues).toEqual(['red'])

		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: { title: 'Colour poll (edited)', poll: { resultsField: 'colour', type: 'mostVoted' } },
			overrideAccess: true,
		})
		expect((await outcomeOf(form.id))?.winningValues).toEqual(['red'])
	})

	it('keeps auto-resolved winningValues when the outcome group is present without winningValues', async () => {
		const form = await makePoll({ type: 'mostVoted' })
		await vote(form.id, 'blue')
		await vote(form.id, 'blue')
		await vote(form.id, 'red')
		await resolvePollOutcome({ payload: booted.payload, formId: form.id })
		const resolvedAt = (await outcomeOf(form.id))?.resolvedAt
		expect((await outcomeOf(form.id))?.winningValues).toEqual(['blue'])

		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: {
				title: 'Colour poll (edited again)',
				poll: { resultsField: 'colour', type: 'mostVoted', outcome: { resolvedAt } },
			},
			overrideAccess: true,
		})
		expect((await outcomeOf(form.id))?.winningValues).toEqual(['blue'])
	})
})
