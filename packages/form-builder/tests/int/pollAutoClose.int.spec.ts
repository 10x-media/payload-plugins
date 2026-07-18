import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { resolveFormResultsRequest } from '../../src/aggregation/resolveResultsRequest'
import { formBuilder } from '../../src/index'
import { POLL_CLOSE_TASK_SLUG, runPollClose } from '../../src/poll/closeJob'
import { definePollType } from '../../src/poll/definePollType'
import { resolvePollOutcome } from '../../src/poll/resolvePollOutcome'

const pastIso = () => new Date(Date.now() - 60_000).toISOString()
const futureIso = () => new Date(Date.now() + 60 * 60_000).toISOString()

type Outcome = { winningValues?: string[]; resolvedAt?: string } | undefined

// A host strategy that ignores the votes and always names a real option: proves a registered
// `definePollType` drives resolution and that its result is still membership-validated.
const alwaysRed = definePollType({
	type: 'alwaysRed',
	label: 'Always red',
	resolveOutcome: () => ['red'],
})

// A host strategy that names a value outside the poll's options: the outcome hook must reject it,
// proving auto-resolved winners are validated exactly like hand-picked ones.
const bogus = definePollType({
	type: 'bogus',
	label: 'Bogus',
	resolveOutcome: () => ['nonexistent'],
})

describeForDb('form-builder poll auto-close', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({ poll: { types: { alwaysRed, bogus } } }),
			db,
		})
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

	// Close an open poll the way an admin would: a partial poll update that only sets closesAt, which
	// Payload merges over the stored group (resultsField/type are preserved).
	const close = async (formId: number | string) =>
		booted.payload.update({
			collection: 'forms',
			id: formId,
			data: { poll: { closesAt: pastIso() } },
		})

	const outcomeOf = async (formId: number | string): Promise<Outcome> => {
		const doc = await booted.payload.findByID({ collection: 'forms', id: formId, depth: 0 })
		return (doc.poll as { outcome?: NonNullable<Outcome> }).outcome
	}

	const pendingCloseJobs = async (formId: number | string): Promise<number> => {
		const { totalDocs } = await booted.payload.find({
			collection: 'payload-jobs',
			where: {
				and: [
					{ taskSlug: { equals: POLL_CLOSE_TASK_SLUG } },
					{ completedAt: { exists: false } },
					{ 'input.formId': { equals: String(formId) } },
				],
			},
			limit: 0,
		})
		return totalDocs
	}

	it('registers the poll-close task', () => {
		const tasks = booted.payload.config.jobs?.tasks ?? []
		expect(tasks.some((task) => task.slug === POLL_CLOSE_TASK_SLUG)).toBe(true)
	})

	it('auto-resolves a mostVoted tie to both winners when the close task handler runs', async () => {
		const form = await makePoll({ type: 'mostVoted' })
		await vote(form.id, 'red')
		await vote(form.id, 'blue')
		await vote(form.id, 'red')
		await vote(form.id, 'blue')
		await vote(form.id, 'red')
		await vote(form.id, 'blue')
		await close(form.id)

		const tasks = booted.payload.config.jobs?.tasks ?? []
		const handler = tasks.find((task) => task.slug === POLL_CLOSE_TASK_SLUG)?.handler as (args: {
			input: { formId: number | string }
			req: { payload: Payload }
		}) => Promise<unknown>
		await handler({ input: { formId: form.id }, req: { payload: booted.payload } })

		const outcome = await outcomeOf(form.id)
		expect([...(outcome?.winningValues ?? [])].sort()).toEqual(['blue', 'red'])
		// The stamp is set by the hook, never by the caller (resolvePollOutcome writes winningValues only).
		expect(typeof outcome?.resolvedAt).toBe('string')
	})

	it('auto-resolves a mostVoted winner to the single top choice', async () => {
		const form = await makePoll({ type: 'mostVoted' })
		await vote(form.id, 'red')
		await vote(form.id, 'red')
		await vote(form.id, 'blue')
		await close(form.id)
		await runPollClose({ payload: booted.payload, input: { formId: form.id } })
		expect((await outcomeOf(form.id))?.winningValues).toEqual(['red'])
	})

	it('the close handler is a no-op while the poll is still open', async () => {
		const form = await makePoll({ type: 'mostVoted', closesAt: futureIso() })
		await vote(form.id, 'red')
		await runPollClose({ payload: booted.payload, input: { formId: form.id } })
		expect((await outcomeOf(form.id))?.winningValues ?? []).toEqual([])
	})

	it('never auto-resolves a manual poll, even closed with votes', async () => {
		const form = await makePoll({ type: 'manual' })
		await vote(form.id, 'red')
		await vote(form.id, 'red')
		await close(form.id)
		await runPollClose({ payload: booted.payload, input: { formId: form.id } })
		expect((await outcomeOf(form.id))?.winningValues ?? []).toEqual([])
	})

	it('heals a closed unresolved mostVoted poll on an anonymous results read', async () => {
		const form = await makePoll({ type: 'mostVoted' })
		await vote(form.id, 'red')
		await vote(form.id, 'red')
		await vote(form.id, 'blue')
		await close(form.id)
		expect((await outcomeOf(form.id))?.winningValues ?? []).toEqual([])

		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
		})
		// afterVote (default) keeps the closed poll's results public, so the gate is unchanged.
		expect(res.status).toBe(200)
		expect((await outcomeOf(form.id))?.winningValues).toEqual(['red'])
	})

	it('does not heal a manual poll on a results read', async () => {
		const form = await makePoll({ type: 'manual' })
		await vote(form.id, 'red')
		await close(form.id)
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
		})
		expect(res.status).toBe(200)
		expect((await outcomeOf(form.id))?.winningValues ?? []).toEqual([])
	})

	it('resolves via a host-registered strategy', async () => {
		const form = await makePoll({ type: 'alwaysRed' })
		await vote(form.id, 'blue')
		await close(form.id)
		await runPollClose({ payload: booted.payload, input: { formId: form.id } })
		expect((await outcomeOf(form.id))?.winningValues).toEqual(['red'])
	})

	it('membership-validates an auto-resolved winner and writes nothing when it fails', async () => {
		const form = await makePoll({ type: 'bogus' })
		await vote(form.id, 'red')
		await close(form.id)
		await expect(resolvePollOutcome({ payload: booted.payload, formId: form.id })).rejects.toThrow()
		expect((await outcomeOf(form.id))?.winningValues ?? []).toEqual([])
	})

	it('supersedes a prior pending close job on re-save instead of stacking', async () => {
		const form = await makePoll({ type: 'mostVoted', closesAt: futureIso() })
		// The afterChange hook scheduled one close job on create.
		expect(await pendingCloseJobs(form.id)).toBe(1)
		// Re-saving reschedules: the prior pending job is deleted before the new one is queued.
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: { title: 'Colour poll (edited)' },
		})
		expect(await pendingCloseJobs(form.id)).toBe(1)
	})
})
