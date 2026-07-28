import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { resolveFormResultsRequest } from '../../src/aggregation/resolveResultsRequest'
import { formBuilder } from '../../src/index'
import { resolvePollOutcome } from '../../src/poll/resolvePollOutcome'
import { recountPollVotes } from '../../src/poll/votes/recountPollVotes'
import { POLL_VOTES_SLUG, RESPONDENTS_VALUE } from '../../src/poll/votes/votesCollection'

type VoteRow = {
	id: number | string
	form?: unknown
	field?: unknown
	value?: unknown
	count?: unknown
}

// Adapter-specific: bumpPollVote takes the Mongo $inc/upsert path or the Postgres
// ON CONFLICT DO UPDATE path, so this earns cross-DB coverage rather than the usual mongo-only default.
describeForDb('form-builder poll vote tally store', { dbs: ['mongo', 'postgres'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	const makeForm = async (over: Record<string, unknown> = {}) =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Vote poll',
				fields: [
					{
						blockType: 'select',
						name: 'vote',
						label: 'Vote',
						options: [
							{ label: 'A', value: 'a' },
							{ label: 'B', value: 'b' },
							{ label: 'C', value: 'c' },
						],
					},
				],
				pollEnabled: true,
				poll: { resultsField: 'vote', type: 'mostVoted' },
				...over,
			},
		})

	const vote = async (formId: number | string, value: string) =>
		booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: { form: formId, values: [{ field: 'vote', value }] },
		})

	// Two transactions racing to $inc-upsert the exact same tally document can hit Mongo's
	// WriteConflict (code 112, labelled TransientTransactionError): the loser's whole transaction
	// aborts, since bumpPollVote's session-joined write cannot retry a transaction that Mongo has
	// already killed. Per MongoDB's own contract, retrying the *whole* operation is the caller's
	// job; Postgres never hits this (its ON CONFLICT DO UPDATE serializes via a row lock instead).
	const isTransientConflict = (error: unknown): boolean =>
		Array.isArray((error as { errorLabels?: unknown })?.errorLabels) &&
		(error as { errorLabels: string[] }).errorLabels.includes('TransientTransactionError')

	const voteRetrying = async (formId: number | string, value: string) => {
		try {
			return await vote(formId, value)
		} catch (error) {
			if (!isTransientConflict(error)) throw error
			return vote(formId, value)
		}
	}

	const tallyRows = async (formId: number | string): Promise<VoteRow[]> => {
		const { docs } = await booted.payload.find({
			collection: POLL_VOTES_SLUG,
			overrideAccess: true,
			where: { form: { equals: String(formId) } },
			limit: 100,
			pagination: false,
			depth: 0,
		})
		return docs as VoteRow[]
	}

	const countOf = (rows: VoteRow[], value: string): number | undefined =>
		rows.find((row) => row.value === value)?.count as number | undefined

	it('counts a completed submission into tally rows including respondents', async () => {
		const form = await makeForm()
		await vote(form.id, 'a')
		const rows = await tallyRows(form.id)
		expect(countOf(rows, 'a')).toBe(1)
		expect(countOf(rows, RESPONDENTS_VALUE)).toBe(1)
	})

	it('does not double count a re-saved complete submission', async () => {
		const form = await makeForm()
		const submission = await vote(form.id, 'a')
		await booted.payload.update({
			collection: 'form-submissions',
			id: submission.id,
			data: { locale: 'de' },
		})
		const rows = await tallyRows(form.id)
		expect(countOf(rows, 'a')).toBe(1)
		expect(countOf(rows, RESPONDENTS_VALUE)).toBe(1)
	})

	it('counts an update transitioning partial to complete once', async () => {
		const form = await makeForm()
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			// Authenticated (admin) creates can set partial; an unauthenticated create is forced
			// to 'complete' by validateSubmission (see submissionStatus.int.spec.ts).
			req: { user: { id: 'admin', collection: 'users' } } as never,
			data: { form: form.id, status: 'partial', values: [{ field: 'vote', value: 'a' }] },
		})
		expect(await tallyRows(form.id)).toEqual([])

		await booted.payload.update({
			collection: 'form-submissions',
			id: submission.id,
			data: { status: 'complete' },
		})
		const rows = await tallyRows(form.id)
		expect(countOf(rows, 'a')).toBe(1)
		expect(countOf(rows, RESPONDENTS_VALUE)).toBe(1)
	})

	it('keeps votes when the submission is pruned', async () => {
		const form = await makeForm({ persistSubmissions: false })
		const submission = await vote(form.id, 'a')
		const found = await booted.payload
			.findByID({ collection: 'form-submissions', id: submission.id })
			.catch(() => null)
		expect(found).toBeNull()

		const rows = await tallyRows(form.id)
		expect(countOf(rows, 'a')).toBe(1)
		expect(countOf(rows, RESPONDENTS_VALUE)).toBe(1)
	})

	it('keeps votes when a submission is deleted by an admin', async () => {
		const form = await makeForm()
		const submission = await vote(form.id, 'a')
		await booted.payload.delete({ collection: 'form-submissions', id: submission.id })
		const rows = await tallyRows(form.id)
		expect(countOf(rows, 'a')).toBe(1)
		expect(countOf(rows, RESPONDENTS_VALUE)).toBe(1)
	})

	it('serves results from tallies with zero-seeded buckets and exact totals', async () => {
		const form = await makeForm()
		await vote(form.id, 'a')
		await vote(form.id, 'a')
		await vote(form.id, 'b')

		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
			pollVotesEnabled: true,
		})
		expect(res.status).toBe(200)
		if (!('results' in res.body)) throw new Error('expected results in response body')
		const [result] = res.body.results
		expect(result?.total).toBe(3)
		expect(result?.truncated).toBe(false)
		expect(
			result?.buckets.map((bucket) => [bucket.value, bucket.count, bucket.percentage])
		).toEqual([
			['a', 2, 66.7],
			['b', 1, 33.3],
			['c', 0, 0],
		])
	})

	it('resolves mostVoted outcome from tallies', async () => {
		const form = await makeForm()
		await vote(form.id, 'a')
		await vote(form.id, 'a')
		await vote(form.id, 'b')

		const winners = await resolvePollOutcome({
			payload: booted.payload,
			formId: form.id,
			pollVotesEnabled: true,
		})
		expect(winners).toEqual(['a'])
	})

	it('recountPollVotes rebuilds tallies from persisted submissions', async () => {
		const form = await makeForm()
		await vote(form.id, 'a')
		await vote(form.id, 'a')

		const before = await tallyRows(form.id)
		const row = before.find((entry) => entry.value === 'a')
		if (!row) throw new Error('expected an "a" tally row')
		await booted.payload.update({
			collection: POLL_VOTES_SLUG,
			id: row.id,
			data: { count: 999 },
			overrideAccess: true,
		})
		expect(countOf(await tallyRows(form.id), 'a')).toBe(999)

		await recountPollVotes({ payload: booted.payload, formId: form.id })
		const after = await tallyRows(form.id)
		expect(countOf(after, 'a')).toBe(2)
		expect(countOf(after, RESPONDENTS_VALUE)).toBe(2)
	})

	it('two concurrent submissions both count', async () => {
		const form = await makeForm()
		await Promise.all([voteRetrying(form.id, 'a'), voteRetrying(form.id, 'a')])
		const rows = await tallyRows(form.id)
		expect(countOf(rows, 'a')).toBe(2)
		expect(countOf(rows, RESPONDENTS_VALUE)).toBe(2)
	})
})

// A dedicated boot (its own DB) rather than an attached second instance, mirroring how other
// specs isolate an alternate plugin config from the main tally-store suite above.
describeForDb(
	'form-builder poll vote tally store (poll.votes disabled)',
	{ dbs: ['mongo', 'postgres'] },
	(db) => {
		let booted: BootedPayload

		beforeAll(async () => {
			booted = await bootPayload({ plugin: formBuilder({ poll: { votes: false } }), db })
		})

		afterAll(async () => {
			await booted.stop()
		})

		it('rejects pollEnabled with persistSubmissions false when poll.votes is false', async () => {
			await expect(
				booted.payload.create({
					collection: 'forms',
					data: {
						title: 'Vote poll',
						fields: [
							{
								blockType: 'select',
								name: 'vote',
								label: 'Vote',
								options: [{ label: 'A', value: 'a' }],
							},
						],
						pollEnabled: true,
						poll: { resultsField: 'vote' },
						persistSubmissions: false,
					},
				})
			).rejects.toThrow()
		})
	}
)
