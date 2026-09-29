import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { createLocalReq, type Endpoint, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { defineAction } from '../../src/actions/defineAction'
import { resolveFormResultsRequest } from '../../src/aggregation/resolveResultsRequest'
import { formBuilder } from '../../src/index'
import { collectionSlugsOf } from '../../src/plugin/collectionSlugs'
import { resolvePollCloseRequest } from '../../src/poll/resolvePollCloseRequest'
import { resolvePollOutcome } from '../../src/poll/resolvePollOutcome'
import { recountPollVotes } from '../../src/poll/votes/recountPollVotes'
import { RESPONDENTS_VALUE } from '../../src/poll/votes/votesCollection'
import { resolveVotedSubmission } from '../../src/submissions/resolveVotedSubmission'
import { hasVotedCookie } from '../../src/submissions/votedCookie'

const FORMS = 'surveys'
const SUBMISSIONS = 'responses'
const TALLIES = 'survey-tallies'
const PREFIX = 'acme-voted-'

type VoteRow = { value?: unknown; count?: unknown }
type Outcome = { winningValues?: string[] } | undefined

// Every plugin collection renamed at once. Listed in `test:matrix` so the Postgres leg runs too: the
// tally write reaches past the Local API into the raw Mongo model and the drizzle table map, which is
// where a slug that only half-propagated would break.
describeForDb('form-builder with renamed collections and cookie prefix', {}, (db) => {
	let booted: BootedPayload
	const recorded: string[] = []

	const recorder = defineAction({
		type: 'recorder',
		label: 'Recorder',
		run: ({ submissionId }) => {
			recorded.push(String(submissionId))
		},
	})

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({
				actions: { recorder },
				overrides: { forms: { slug: FORMS }, formSubmissions: { slug: SUBMISSIONS } },
				poll: {
					votedCookie: true,
					cookiePrefix: PREFIX,
					votes: { overrides: { slug: TALLIES } },
				},
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const makePoll = (over: Record<string, unknown> = {}) =>
		booted.payload.create({
			collection: FORMS,
			data: {
				title: 'Renamed poll',
				fields: [
					{
						blockType: 'select',
						name: 'vote',
						label: 'Vote',
						options: [
							{ label: 'A', value: 'a' },
							{ label: 'B', value: 'b' },
						],
					},
				],
				pollEnabled: true,
				poll: { resultsField: 'vote', type: 'mostVoted', allowChange: true },
				...over,
			},
		})

	/** Drives the registered root POST through a real one-shot Request, as a browser submit would. */
	const submit = async (
		data: Record<string, unknown>,
		cookieHeader?: string
	): Promise<{ status: number; doc?: { id: number | string }; req: PayloadRequest }> => {
		const endpoints = booted.payload.collections[SUBMISSIONS]?.config.endpoints
		const endpoint = (Array.isArray(endpoints) ? endpoints : []).find(
			(entry: Endpoint) => entry.method === 'post' && entry.path === '/'
		)
		if (!endpoint) throw new Error(`no root POST endpoint on ${SUBMISSIONS}`)
		const request = new Request(`http://localhost/api/${SUBMISSIONS}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(cookieHeader ? { cookie: cookieHeader } : {}),
			},
			body: JSON.stringify(data),
		})
		const req = await createLocalReq(
			{ req: request as unknown as Partial<PayloadRequest> },
			booted.payload
		)
		req.routeParams = { collection: SUBMISSIONS }
		const response = await endpoint.handler(req)
		const body = (await response.json()) as { doc?: { id: number | string } }
		return { status: response.status, doc: body.doc, req }
	}

	const cookieOf = (req: PayloadRequest): string => {
		const [pair] = (req.responseHeaders?.get('set-cookie') ?? '').split(';')
		if (!pair) throw new Error('no voted cookie was set')
		return pair.trim()
	}

	const tally = async (formId: number | string, value: string): Promise<number> => {
		const { docs } = await booted.payload.find({
			collection: TALLIES,
			overrideAccess: true,
			where: { and: [{ form: { equals: String(formId) } }, { value: { equals: value } }] },
			limit: 0,
		})
		return (docs as VoteRow[]).reduce((sum, row) => sum + Number(row.count ?? 0), 0)
	}

	it('registers each collection under its configured slug and nothing under the defaults', () => {
		expect(collectionSlugsOf(booted.payload)).toEqual({
			forms: FORMS,
			formSubmissions: SUBMISSIONS,
			pollVotes: TALLIES,
		})
		for (const slug of [FORMS, SUBMISSIONS, TALLIES]) {
			expect(booted.payload.collections[slug]).toBeDefined()
		}
		for (const slug of ['forms', 'form-submissions', 'form-poll-votes']) {
			expect(booted.payload.collections[slug]).toBeUndefined()
		}
	})

	it('creates a submission related to the renamed form, tallies it, and sets the prefixed cookie', async () => {
		const form = await makePoll()
		const { status, doc, req } = await submit({
			form: form.id,
			values: [{ field: 'vote', value: 'a' }],
		})
		expect(status).toBe(201)
		const stored = await booted.payload.findByID({
			collection: SUBMISSIONS,
			id: doc?.id as number | string,
			depth: 0,
			overrideAccess: true,
		})
		expect(String((stored as { form?: unknown }).form)).toBe(String(form.id))
		expect(cookieOf(req).startsWith(`${PREFIX}${form.id}=`)).toBe(true)
		expect(await tally(form.id, 'a')).toBe(1)
		expect(await tally(form.id, RESPONDENTS_VALUE)).toBe(1)
	})

	it('changes a vote in place through the signed cookie, moving the tally', async () => {
		const form = await makePoll()
		const first = await submit({ form: form.id, values: [{ field: 'vote', value: 'a' }] })
		const cookie = cookieOf(first.req)
		const second = await submit({ form: form.id, values: [{ field: 'vote', value: 'b' }] }, cookie)
		expect(second.status).toBe(200)
		expect(String(second.doc?.id)).toBe(String(first.doc?.id))
		const { totalDocs } = await booted.payload.count({
			collection: SUBMISSIONS,
			where: { form: { equals: form.id } },
		})
		expect(totalDocs).toBe(1)
		expect(await tally(form.id, 'a')).toBe(0)
		expect(await tally(form.id, 'b')).toBe(1)
		expect(await tally(form.id, RESPONDENTS_VALUE)).toBe(1)
	})

	it('reads the voter back through the host helpers with the configured cookie name', async () => {
		const form = await makePoll()
		const { req } = await submit({ form: form.id, values: [{ field: 'vote', value: 'b' }] })
		const cookie = cookieOf(req)
		expect(hasVotedCookie(cookie, form.id, booted.payload)).toBe(true)
		expect(hasVotedCookie(cookie, form.id)).toBe(false)
		const vote = await resolveVotedSubmission({
			payload: booted.payload,
			cookieHeader: cookie,
			formId: form.id,
		})
		expect(vote?.pick).toEqual(['b'])
	})

	it('serves results, recounts, resolves an outcome, and closes the poll against the renamed collections', async () => {
		const form = await makePoll({ poll: { resultsField: 'vote', type: 'mostVoted' } })
		for (const value of ['a', 'a', 'b']) {
			expect((await submit({ form: form.id, values: [{ field: 'vote', value }] })).status).toBe(201)
		}
		const read = async () => {
			const req = await createLocalReq({}, booted.payload)
			const res = await resolveFormResultsRequest({
				payload: booted.payload,
				formId: form.id,
				isAuthed: true,
				req,
			})
			expect(res.status).toBe(200)
			const [result] = (res.body as { results: { buckets: VoteRow[] }[] }).results
			return Object.fromEntries(
				(result?.buckets ?? []).map((bucket) => [String(bucket.value), Number(bucket.count)])
			)
		}
		expect(await read()).toMatchObject({ a: 2, b: 1 })

		await recountPollVotes({ payload: booted.payload, formId: form.id })
		expect(await read()).toMatchObject({ a: 2, b: 1 })

		await resolvePollOutcome({ payload: booted.payload, formId: form.id })
		const resolved = await booted.payload.findByID({
			collection: FORMS,
			id: form.id,
			depth: 0,
			overrideAccess: true,
		})
		const outcome = (resolved as { poll?: { outcome?: Outcome } }).poll?.outcome
		expect(outcome?.winningValues).toEqual(['a'])

		const req = await createLocalReq({}, booted.payload)
		const closed = await resolvePollCloseRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: true,
			req,
		})
		expect(closed.status).toBe(200)
	})

	it('runs actions and prunes from the renamed submissions collection', async () => {
		recorded.length = 0
		const form = await booted.payload.create({
			collection: FORMS,
			data: {
				title: 'Renamed signup',
				persistSubmissions: false,
				fields: [{ blockType: 'text', name: 'name', label: 'Name' }],
				actions: [{ blockType: 'recorder' }],
			},
		})
		const { status, doc } = await submit({
			form: form.id,
			values: [{ field: 'name', value: 'Ada' }],
		})
		expect(status).toBe(201)
		await vi.waitFor(async () => {
			expect(recorded).toContain(String(doc?.id))
			const { totalDocs } = await booted.payload.count({
				collection: SUBMISSIONS,
				where: { form: { equals: form.id } },
			})
			expect(totalDocs).toBe(0)
		})
	})

	it('enforces notAlreadySubmitted by querying the renamed submissions collection', async () => {
		const form = await booted.payload.create({
			collection: FORMS,
			data: {
				title: 'Renamed dedup',
				fields: [
					{
						blockType: 'email',
						name: 'email',
						label: 'Email',
						validations: [{ blockType: 'notAlreadySubmitted' }],
					},
				],
			},
		})
		const values = [{ field: 'email', value: 'once@example.com' }]
		expect((await submit({ form: form.id, values })).status).toBe(201)
		// Called directly, the handler surfaces the ValidationError the router would map to a 400.
		await expect(submit({ form: form.id, values })).rejects.toThrow(/email/)
	})
})
