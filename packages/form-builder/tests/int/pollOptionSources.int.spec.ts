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
import { resolvePollOutcome } from '../../src/poll/resolvePollOutcome'
import { defaultValidationRules } from '../../src/validation/builtin'
import { resolveValidationRules } from '../../src/validation/registry'

const resolveCalls: PollOptionResolveArgs[] = []

const athletes = definePollOptionSource<{ eventId?: string }>({
	type: 'athletes',
	label: 'Athletes',
	config: [{ name: 'eventId', type: 'text' }],
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

	it('field access blocks outcome writes without overrideAccess', async () => {
		const form = await makeForm()
		await resolvePollOutcome({ payload: booted.payload, formId: form.id, winningValue: 'ada' })
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: { poll: { outcome: { winningValue: 'hacked', resolvedAt: null } } },
			overrideAccess: false,
		})
		const after = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
		const outcome = (after.poll as { outcome?: { winningValue?: string; resolvedAt?: string } })
			.outcome
		expect(outcome?.winningValue).toBe('ada')
		expect(outcome?.resolvedAt).toBeTruthy()
	})
})
