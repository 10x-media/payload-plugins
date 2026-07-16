import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Field } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { resolveFormResultsRequest } from '../../src/aggregation/resolveResultsRequest'
import { buildFormsCollection } from '../../src/collections/forms'
import { buildDefaultFieldDefinitions } from '../../src/fields/builtin'
import { resolveFieldTypes } from '../../src/fields/registry'
import { formBuilder } from '../../src/index'
import type { PollOptionResolveArgs } from '../../src/poll/definePollOptionSource'
import { definePollOptionSource } from '../../src/poll/definePollOptionSource'
import { resolvePollOptions } from '../../src/poll/resolvePollOptions'
import { resolvePollOptionsRequest } from '../../src/poll/resolvePollOptionsRequest'
import { resolvePollOutcome } from '../../src/poll/resolvePollOutcome'
import { defaultValidationRules } from '../../src/validation/builtin'
import { resolveValidationRules } from '../../src/validation/registry'

const resolveCalls: PollOptionResolveArgs[] = []

const athletes = definePollOptionSource<{ eventId?: string; winner?: string }>({
	type: 'athletes',
	label: 'Athletes',
	config: [
		{ name: 'eventId', type: 'text' },
		{ name: 'winner', type: 'text' },
	],
	resolve: (args) => {
		resolveCalls.push(args)
		if (args.config.eventId === 'boom') {
			throw new Error('source down')
		}
		if (args.config.eventId === 'empty') {
			return []
		}
		return [
			{ label: 'Ada', value: 'ada' },
			{ label: 'Grace', value: 'grace' },
		]
	},
	resolveOutcome: ({ config }) => config.winner,
})

const pollSubfieldNames = (collection: CollectionConfig): (string | undefined)[] => {
	const poll = collection.fields.find(
		(field) => 'name' in field && field.name === 'poll'
	) as Extract<Field, { type: 'group' }>
	return poll.fields.map((field) => ('name' in field ? field.name : undefined))
}

describeForDb('form-builder poll option sources', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({
				poll: { sources: { athletes } },
				// Opens collection-level update for anonymous local API calls so the outcome test
				// reaches field-level access; the outcome fields must still refuse the write.
				overrides: { forms: { access: { update: () => true } } },
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const makeForm = async (pollOver: Record<string, unknown> = {}) =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Race prediction',
				fields: [{ blockType: 'select', name: 'winner', label: 'Winner', options: [] }],
				poll: {
					enabled: true,
					resultsField: 'winner',
					optionSource: 'athletes',
					sourceConfig: { eventId: 'race-1' },
					...pollOver,
				},
			},
		})

	const vote = async (formId: number | string, value: string) =>
		booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: { form: formId, values: [{ field: 'winner', value }] },
		})

	const fieldErrorOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
		try {
			await promise
		} catch (error) {
			return (error as { data?: { errors?: { message?: string }[] } }).data?.errors?.[0]?.message
		}
		throw new Error('expected the write to be rejected')
	}

	it('adds the optionSource select and sourceConfig group when sources are registered', () => {
		const formsCollection = booted.payload.collections.forms
		if (!formsCollection) {
			throw new Error('forms collection missing')
		}
		const names = pollSubfieldNames(formsCollection.config)
		expect(names).toContain('optionSource')
		expect(names).toContain('sourceConfig')
		expect(names).toContain('outcome')
	})

	it('omits the source fields entirely when no source is registered', () => {
		const collection = buildFormsCollection({
			registry: resolveFieldTypes(buildDefaultFieldDefinitions(true)),
			ruleRegistry: resolveValidationRules(defaultValidationRules),
		})
		const names = pollSubfieldNames(collection)
		expect(names).not.toContain('optionSource')
		expect(names).not.toContain('sourceConfig')
		expect(names).toContain('outcome')
	})

	it('accepts a submission whose value the source resolved', async () => {
		const form = await makeForm()
		const submission = await vote(form.id, 'ada')
		expect(submission.id).toBeDefined()
		const descriptors = submission.descriptors as { field: string; optionLabels?: unknown }[]
		expect(descriptors.find((d) => d.field === 'winner')?.optionLabels).toEqual({
			ada: 'Ada',
			grace: 'Grace',
		})
	})

	it('rejects a value outside the resolved set even though the field has no authored options', async () => {
		const form = await makeForm()
		await expect(vote(form.id, 'zorro')).rejects.toThrow()
	})

	it('fails closed when the source resolve throws', async () => {
		const form = await makeForm({ sourceConfig: { eventId: 'boom' } })
		await expect(vote(form.id, 'ada')).rejects.toThrow(/unavailable/i)
	})

	it('passes the authored sourceConfig and form identity to resolve()', async () => {
		resolveCalls.length = 0
		const form = await makeForm({ sourceConfig: { eventId: 'race-42' } })
		await vote(form.id, 'grace')
		const call = resolveCalls.at(-1)
		expect(call?.config).toMatchObject({ eventId: 'race-42' })
		expect(call?.form).toEqual({ id: form.id, title: 'Race prediction' })
		expect(call?.payload).toBe(booted.payload)
	})

	it('resolves options for hosts through payload.config.custom', async () => {
		const form = await makeForm()
		const options = await resolvePollOptions({ payload: booted.payload, form })
		expect(options).toEqual([
			{ label: 'Ada', value: 'ada' },
			{ label: 'Grace', value: 'grace' },
		])
	})

	it('serves anonymous results for a sourced poll, buckets seeded in resolved order with source labels', async () => {
		const form = await makeForm()
		await vote(form.id, 'grace')
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
		})
		expect(res.status).toBe(200)
		const results = 'results' in res.body ? res.body.results : []
		expect(results[0]?.total).toBe(1)
		expect(results[0]?.buckets.map((b) => [b.value, b.label, b.count])).toEqual([
			['ada', 'Ada', 0],
			['grace', 'Grace', 1],
		])
	})

	it('fails closed (503) when the source throws on the anonymous results path', async () => {
		const form = await makeForm({ sourceConfig: { eventId: 'boom' } })
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
		})
		expect(res.status).toBe(503)
		expect('errors' in res.body).toBe(true)
	})

	it('forbids anonymous results when the source resolves zero options', async () => {
		const form = await makeForm({ sourceConfig: { eventId: 'empty' } })
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
		})
		expect(res.status).toBe(403)
	})

	it('forbids anonymous sourced results when the results field type is not poll-eligible', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Planted sourced poll',
				fields: [
					{ blockType: 'select', name: 'winner', label: 'Winner', options: [] },
					{ blockType: 'text', name: 'note', label: 'Note' },
				],
				poll: { enabled: true, resultsField: 'winner', optionSource: 'athletes' },
			},
		})
		// The resultsField validate refuses a non-eligible field, so the misconfiguration is
		// planted below Payload to prove the endpoint's read-time gate holds for legacy docs.
		await booted.payload.db.updateOne({
			collection: 'forms',
			id: form.id,
			data: { poll: { enabled: true, resultsField: 'note', optionSource: 'athletes' } },
		})
		const gated = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
			eligibleTypes: ['select'],
		})
		expect(gated.status).toBe(403)

		// Without the gate the request resolves options and serves results, which is exactly
		// the leftover-bucket exposure the eligibleTypes check exists to prevent.
		const ungated = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
		})
		expect(ungated.status).toBe(200)
	})

	it('leaves the authed results path unaffected by source resolution', async () => {
		const form = await makeForm({ sourceConfig: { eventId: 'boom' } })
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			field: 'winner',
			isAuthed: true,
		})
		expect(res.status).toBe(200)
	})

	it('records the outcome via resolvePollOutcome and rejects non-poll forms', async () => {
		const form = await makeForm()
		await resolvePollOutcome({ payload: booted.payload, formId: form.id, winningValue: 'ada' })
		const updated = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
		const outcome = (updated.poll as { outcome?: { winningValue?: string; resolvedAt?: string } })
			.outcome
		expect(outcome?.winningValue).toBe('ada')
		expect(typeof outcome?.resolvedAt).toBe('string')

		const plain = await booted.payload.create({
			collection: 'forms',
			data: { title: 'No poll', fields: [] },
		})
		await expect(
			resolvePollOutcome({ payload: booted.payload, formId: plain.id, winningValue: 'ada' })
		).rejects.toThrow(/not poll-enabled/)
	})

	it('rejects an explicit outcome outside the resolved options', async () => {
		const form = await makeForm()
		const message = await fieldErrorOf(
			resolvePollOutcome({ payload: booted.payload, formId: form.id, winningValue: 'zorro' })
		)
		expect(message).toBe('The winning value must be one of the poll options.')
	})

	it('resolves the outcome from the source when winningValue is omitted', async () => {
		const form = await makeForm({ sourceConfig: { eventId: 'race-1', winner: 'grace' } })
		const recorded = await resolvePollOutcome({ payload: booted.payload, formId: form.id })
		expect(recorded).toBe('grace')
		const updated = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
		const outcome = (updated.poll as { outcome?: { winningValue?: string; resolvedAt?: string } })
			.outcome
		expect(outcome?.winningValue).toBe('grace')
		expect(outcome?.resolvedAt).toBeTruthy()
	})

	it('explains auto mode failures', async () => {
		const undecided = await makeForm({ sourceConfig: { eventId: 'race-1' } })
		await expect(
			resolvePollOutcome({ payload: booted.payload, formId: undecided.id })
		).rejects.toThrow(/not be decided yet/)

		const sourceless = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Static poll',
				fields: [
					{
						blockType: 'select',
						name: 'winner',
						label: 'Winner',
						options: [{ label: 'Ada', value: 'ada' }],
					},
				],
				poll: { enabled: true, resultsField: 'winner' },
			},
		})
		await expect(
			resolvePollOutcome({ payload: booted.payload, formId: sourceless.id })
		).rejects.toThrow(/no poll option source/)
	})

	it('accepts an admin-path winner, stamps resolvedAt, and clears both together', async () => {
		const form = await makeForm()
		const before = Date.now()
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: { poll: { outcome: { winningValue: 'ada' } } },
			overrideAccess: false,
		})
		const recorded = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
		const outcome = (recorded.poll as { outcome?: { winningValue?: string; resolvedAt?: string } })
			.outcome
		expect(outcome?.winningValue).toBe('ada')
		expect(Date.parse(outcome?.resolvedAt ?? '')).toBeGreaterThanOrEqual(before)

		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: { poll: { outcome: { winningValue: '' } } },
			overrideAccess: false,
		})
		const cleared = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
		const clearedOutcome = (
			cleared.poll as { outcome?: { winningValue?: string | null; resolvedAt?: string | null } }
		).outcome
		expect(clearedOutcome?.winningValue ?? null).toBeNull()
		expect(clearedOutcome?.resolvedAt ?? null).toBeNull()
	})

	it('rejects an admin-path winner outside the resolved options', async () => {
		const form = await makeForm()
		const message = await fieldErrorOf(
			booted.payload.update({
				collection: 'forms',
				id: form.id,
				data: { poll: { outcome: { winningValue: 'zorro' } } },
				overrideAccess: false,
			})
		)
		expect(message).toBe('The winning value must be one of the poll options.')
	})

	it('keeps resolvedAt locked against direct writes', async () => {
		const form = await makeForm()
		await resolvePollOutcome({ payload: booted.payload, formId: form.id, winningValue: 'ada' })
		const recorded = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
		const stamp = (recorded.poll as { outcome?: { resolvedAt?: string } }).outcome?.resolvedAt
		expect(stamp).toBeTruthy()

		// Same winner, tampered stamp: the field access strips resolvedAt and the hook sees no
		// transition, so the stored stamp survives.
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: { poll: { outcome: { winningValue: 'ada', resolvedAt: '2000-01-01T00:00:00.000Z' } } },
			overrideAccess: false,
		})
		const after = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
		const outcome = (after.poll as { outcome?: { winningValue?: string; resolvedAt?: string } })
			.outcome
		expect(outcome?.winningValue).toBe('ada')
		expect(outcome?.resolvedAt).toBe(stamp)

		// A stamp write without touching the winner is ignored the same way.
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: { poll: { outcome: { resolvedAt: '2000-01-01T00:00:00.000Z' } } },
			overrideAccess: false,
		})
		const untouched = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
		expect((untouched.poll as { outcome?: { resolvedAt?: string } }).outcome?.resolvedAt).toBe(
			stamp
		)
	})

	it('registers the poll-options endpoint on the forms collection', () => {
		const endpoints = booted.payload.collections.forms?.config.endpoints
		expect(
			Array.isArray(endpoints) &&
				endpoints.some((endpoint) => endpoint.path === '/:id/poll-options')
		).toBe(true)
	})

	it('serves poll options to authed callers only', async () => {
		const form = await makeForm()
		const anon = await resolvePollOptionsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
		})
		expect(anon.status).toBe(403)

		const authed = await resolvePollOptionsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: true,
		})
		expect(authed.status).toBe(200)
		expect('options' in authed.body ? authed.body.options : []).toEqual([
			{ label: 'Ada', value: 'ada' },
			{ label: 'Grace', value: 'grace' },
		])
	})

	it('serves authored options for a static poll and errors like the results endpoint', async () => {
		const staticPoll = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Static poll',
				fields: [
					{
						blockType: 'select',
						name: 'winner',
						label: 'Winner',
						options: [{ label: 'Ada', value: 'ada' }],
					},
				],
				poll: { enabled: true, resultsField: 'winner' },
			},
		})
		const res = await resolvePollOptionsRequest({
			payload: booted.payload,
			formId: staticPoll.id,
			isAuthed: true,
		})
		expect(res.status).toBe(200)
		expect('options' in res.body ? res.body.options : []).toEqual([{ label: 'Ada', value: 'ada' }])

		const missing = await resolvePollOptionsRequest({
			payload: booted.payload,
			formId: 999999,
			isAuthed: true,
		})
		expect(missing.status).toBe(404)

		const broken = await makeForm({ sourceConfig: { eventId: 'boom' } })
		const failed = await resolvePollOptionsRequest({
			payload: booted.payload,
			formId: broken.id,
			isAuthed: true,
		})
		expect(failed.status).toBe(503)
		expect('errors' in failed.body).toBe(true)
	})
})
