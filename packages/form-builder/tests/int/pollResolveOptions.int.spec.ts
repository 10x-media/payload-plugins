import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Field } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { resolveFormResultsRequest } from '../../src/aggregation/resolveResultsRequest'
import type { AnyFormFieldDefinition } from '../../src/fields/types'
import { formBuilder } from '../../src/index'
import { resolvePollOptionsRequest } from '../../src/poll/resolvePollOptionsRequest'

const athletes: CollectionConfig = {
	slug: 'athletes',
	fields: [{ name: 'name', type: 'text' }],
}

/**
 * A synthetic `pollEligible` field type that sources its poll choices from a `hasMany` relationship
 * it holds, resolving the athlete ids to labeled options with `payload.find`. Mirrors the athleteVote
 * case S5 builds for real: no poll option source, no authored `options`, just a custom type
 * enumerating the records the author selected.
 */
const athleteVote: AnyFormFieldDefinition = {
	type: 'athleteVote',
	label: 'Athlete vote',
	value: 'text',
	pollEligible: true,
	config: [{ name: 'athletes', type: 'relationship', relationTo: 'athletes', hasMany: true }],
	resolveOptions: async ({ instance, payload, req }) => {
		const raw = instance.athletes
		const ids: (string | number)[] = Array.isArray(raw) ? (raw as (string | number)[]) : []
		if (ids.length === 0) {
			return []
		}
		const found = await payload.find({
			collection: 'athletes',
			where: { id: { in: ids } },
			depth: 0,
			overrideAccess: true,
			req,
			limit: 100,
		})
		const byId = new Map<string, { id: number | string; name?: unknown }>(
			found.docs.map((doc) => [String(doc.id), doc as { id: number | string; name?: unknown }])
		)
		// Preserve the author's selection order; the `in` query returns database order.
		return ids
			.map((id) => byId.get(String(id)))
			.filter((doc): doc is { id: number | string; name?: unknown } => doc !== undefined)
			.map((doc) => ({
				value: String(doc.id),
				label: typeof doc.name === 'string' ? doc.name : String(doc.id),
			}))
	},
}

/** A distinct client component ref, so the seam swap is observable on the built collection. */
const SWAPPED_WINNING_REF = '@10x-media/form-builder/client#FieldNameSelect'

const winningValuesField = (collection: CollectionConfig): Field | undefined => {
	const tabs = collection.fields.find((f) => f.type === 'tabs')
	const pollTab =
		tabs?.type === 'tabs'
			? tabs.tabs.find((t) => t.fields.some((f) => 'name' in f && f.name === 'poll'))
			: undefined
	const poll = pollTab?.fields.find((field) => 'name' in field && field.name === 'poll') as Extract<
		Field,
		{ type: 'group' }
	>
	const outcome = poll.fields.find(
		(field) => 'name' in field && field.name === 'outcome'
	) as Extract<Field, { type: 'group' }>
	return outcome.fields.find((field) => 'name' in field && field.name === 'winningValues')
}

describeForDb('form-builder poll resolveOptions', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let athleteIds: (string | number)[] = []

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({
				fields: { athleteVote },
				poll: {
					// Swap the winner component but keep the field name/type, to prove the beforeChange
					// hook still validates the stored value regardless of what renders it. The cast
					// mirrors forms.ts `halfWidth`: spreading a union-typed Field loses the discriminant.
					outcomeFields: ({ defaultFields }) => [
						{
							...defaultFields.winningValues,
							admin: { components: { Field: { path: SWAPPED_WINNING_REF } } },
						} as Field,
						defaultFields.resolvedAt,
					],
				},
				// Opens collection-level update for anonymous local API calls so the outcome test
				// reaches the beforeChange membership check; the swapped component must not bypass it.
				overrides: { forms: { access: { update: () => true } } },
			}),
			db,
			collections: [athletes],
		})
		const created = await Promise.all(
			['Ada', 'Grace', 'Linus', 'Margaret'].map((name) =>
				booted.payload.create({ collection: 'athletes', data: { name } })
			)
		)
		athleteIds = created.map((doc) => doc.id)
	})

	afterAll(async () => {
		await booted.stop()
	})

	const shortlist = () => athleteIds.slice(0, 3)

	const makeVoteForm = async () =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Best athlete',
				fields: [{ blockType: 'athleteVote', name: 'pick', label: 'Pick', athletes: shortlist() }],
				pollEnabled: true,
				poll: { resultsField: 'pick' },
			},
		})

	const vote = async (formId: number | string, value: string) =>
		booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: { form: formId, values: [{ field: 'pick', value }] },
		})

	const fieldErrorOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
		try {
			await promise
		} catch (error) {
			return (error as { data?: { errors?: { message?: string }[] } }).data?.errors?.[0]?.message
		}
		throw new Error('expected the write to be rejected')
	}

	it('accepts a submission whose value the resolver produced and labels it', async () => {
		const form = await makeVoteForm()
		const submission = await vote(form.id, String(athleteIds[0]))
		expect(submission.id).toBeDefined()
		const descriptors = submission.descriptors as { field: string; optionLabels?: unknown }[]
		expect(descriptors.find((d) => d.field === 'pick')?.optionLabels).toMatchObject({
			[String(athleteIds[0])]: 'Ada',
			[String(athleteIds[1])]: 'Grace',
			[String(athleteIds[2])]: 'Linus',
		})
	})

	it('rejects a value outside the resolver set even though the field has no authored options', async () => {
		const form = await makeVoteForm()
		await expect(vote(form.id, 'not-an-athlete')).rejects.toThrow()
	})

	it('serves anonymous results for a resolveOptions poll, buckets labeled from the resolver', async () => {
		const form = await makeVoteForm()
		await vote(form.id, String(athleteIds[0]))
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
			eligibleTypes: ['athleteVote'],
		})
		expect(res.status).toBe(200)
		const results = 'results' in res.body ? res.body.results : []
		expect(results[0]?.buckets.map((b) => [b.value, b.label, b.count])).toEqual([
			[String(athleteIds[0]), 'Ada', 1],
			[String(athleteIds[1]), 'Grace', 0],
			[String(athleteIds[2]), 'Linus', 0],
		])
	})

	it('gates anonymous resolveOptions results when the results field type is not eligible', async () => {
		const form = await makeVoteForm()
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
			eligibleTypes: ['select'],
		})
		expect(res.status).toBe(403)
	})

	it('labels an authed read of a resolveOptions poll instead of showing raw values', async () => {
		const form = await makeVoteForm()
		await vote(form.id, String(athleteIds[1]))
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			field: 'pick',
			isAuthed: true,
		})
		expect(res.status).toBe(200)
		const results = 'results' in res.body ? res.body.results : []
		const bucket = results[0]?.buckets.find((b) => b.value === String(athleteIds[1]))
		expect(bucket?.label).toBe('Grace')
		expect(bucket?.count).toBe(1)
	})

	it('surfaces a resolveOptions field in an authed all-fields read', async () => {
		const form = await makeVoteForm()
		await vote(form.id, String(athleteIds[2]))
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: true,
		})
		expect(res.status).toBe(200)
		const results = 'results' in res.body ? res.body.results : []
		const pick = results.find((r) => r.field === 'pick')
		expect(pick?.buckets.find((b) => b.value === String(athleteIds[2]))?.label).toBe('Linus')
	})

	it('feeds the admin winner select via the poll-options endpoint', async () => {
		const form = await makeVoteForm()
		const res = await resolvePollOptionsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: true,
		})
		expect(res.status).toBe(200)
		expect('options' in res.body ? res.body.options : []).toEqual([
			{ value: String(athleteIds[0]), label: 'Ada' },
			{ value: String(athleteIds[1]), label: 'Grace' },
			{ value: String(athleteIds[2]), label: 'Linus' },
		])
	})

	it('swaps the winningValues component through the outcomeFields seam', () => {
		const collection = booted.payload.collections.forms
		if (!collection) {
			throw new Error('forms collection missing')
		}
		const field = winningValuesField(collection.config)
		const path = (field as { admin?: { components?: { Field?: { path?: string } } } } | undefined)
			?.admin?.components?.Field?.path
		expect(path).toBe(SWAPPED_WINNING_REF)
	})

	it('still validates outcome membership when the winningValues component is swapped', async () => {
		const form = await makeVoteForm()
		const message = await fieldErrorOf(
			booted.payload.update({
				collection: 'forms',
				id: form.id,
				data: { poll: { outcome: { winningValues: ['not-an-athlete'] } } },
				overrideAccess: false,
			})
		)
		expect(message).toBe('The winning value must be one of the poll options.')

		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: { poll: { outcome: { winningValues: [String(athleteIds[0])] } } },
			overrideAccess: false,
		})
		const recorded = await booted.payload.findByID({ collection: 'forms', id: form.id, depth: 0 })
		const outcome = (
			recorded.poll as { outcome?: { winningValues?: string[]; resolvedAt?: string } }
		).outcome
		expect(outcome?.winningValues).toEqual([String(athleteIds[0])])
		expect(typeof outcome?.resolvedAt).toBe('string')
	})
})
