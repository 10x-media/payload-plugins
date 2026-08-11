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

	// Sharded tallies (VOTE_SHARDS) make same-document transactional writes rare, but two
	// transactions can still pick the same shard: Mongo then aborts one (WriteConflict) and the
	// losing submission rolls back whole, so counts stay consistent either way. The retry mirrors
	// what a real client does: the visitor's browser resubmits the failed vote, as often as needed.
	// Detection is deliberately broad, the TransientTransactionError label is not always attached
	// (a conflict surfacing at commit carries only WriteConflict code 112 and the "please retry"
	// message), and one retry can itself collide again under four concurrent votes. Postgres never
	// needs any of this (ON CONFLICT DO UPDATE serializes via a row lock instead of aborting).
	const isTransientConflict = (error: unknown): boolean => {
		const err = error as { errorLabels?: unknown; code?: unknown; message?: unknown } | null
		if (Array.isArray(err?.errorLabels) && err.errorLabels.includes('TransientTransactionError')) {
			return true
		}
		if (err?.code === 112) {
			return true
		}
		return typeof err?.message === 'string' && /retry your operation/i.test(err.message)
	}

	const voteRetrying = async (formId: number | string, value: string) => {
		for (let attempt = 0; ; attempt++) {
			try {
				return await vote(formId, value)
			} catch (error) {
				if (attempt >= 4 || !isTransientConflict(error)) throw error
				// Jitter decorrelates two losers retrying at once, which would otherwise keep
				// re-colliding on the same shard pick under slow CI interleaving.
				await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 25))
			}
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

	// Tally rows are sharded, so any per-value assertion must sum across the value's shard rows.
	const sumByValue = (rows: VoteRow[], value: string): number =>
		rows
			.filter((row) => row.value === value)
			.reduce((sum, row) => sum + (typeof row.count === 'number' ? row.count : 0), 0)

	it('counts a completed submission into tally rows including respondents', async () => {
		const form = await makeForm()
		await vote(form.id, 'a')
		const rows = await tallyRows(form.id)
		expect(sumByValue(rows, 'a')).toBe(1)
		expect(sumByValue(rows, RESPONDENTS_VALUE)).toBe(1)
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
		expect(sumByValue(rows, 'a')).toBe(1)
		expect(sumByValue(rows, RESPONDENTS_VALUE)).toBe(1)
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
		expect(sumByValue(rows, 'a')).toBe(1)
		expect(sumByValue(rows, RESPONDENTS_VALUE)).toBe(1)
	})

	it('keeps votes when the submission is pruned', async () => {
		const form = await makeForm({ persistSubmissions: false })
		const submission = await vote(form.id, 'a')
		const found = await booted.payload
			.findByID({ collection: 'form-submissions', id: submission.id })
			.catch(() => null)
		expect(found).toBeNull()

		const rows = await tallyRows(form.id)
		expect(sumByValue(rows, 'a')).toBe(1)
		expect(sumByValue(rows, RESPONDENTS_VALUE)).toBe(1)
	})

	it('keeps votes when a submission is deleted by an admin', async () => {
		const form = await makeForm()
		const submission = await vote(form.id, 'a')
		await booted.payload.delete({ collection: 'form-submissions', id: submission.id })
		const rows = await tallyRows(form.id)
		expect(sumByValue(rows, 'a')).toBe(1)
		expect(sumByValue(rows, RESPONDENTS_VALUE)).toBe(1)
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
		// The two bumps may sit on one or two shard rows; only one row was drifted to 999.
		const drifted = sumByValue(before, 'a') - (row.count as number) + 999
		expect(sumByValue(await tallyRows(form.id), 'a')).toBe(drifted)

		await recountPollVotes({ payload: booted.payload, formId: form.id })
		const after = await tallyRows(form.id)
		expect(sumByValue(after, 'a')).toBe(2)
		expect(sumByValue(after, RESPONDENTS_VALUE)).toBe(2)
	})

	it('concurrent submissions all count across shard rows', async () => {
		const form = await makeForm()
		await Promise.all([
			voteRetrying(form.id, 'a'),
			voteRetrying(form.id, 'a'),
			voteRetrying(form.id, 'b'),
			voteRetrying(form.id, 'a'),
		])
		const rows = await tallyRows(form.id)
		expect(sumByValue(rows, 'a')).toBe(3)
		expect(sumByValue(rows, 'b')).toBe(1)
		expect(sumByValue(rows, RESPONDENTS_VALUE)).toBe(4)
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
