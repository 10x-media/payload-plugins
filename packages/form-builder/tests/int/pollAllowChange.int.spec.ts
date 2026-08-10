import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { createLocalReq, type Endpoint, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'
import { POLL_VOTES_SLUG, RESPONDENTS_VALUE } from '../../src/poll/votes/votesCollection'
import { votedCookieName, votedSubmissionIdFromCookie } from '../../src/submissions/votedCookie'

type VoteRow = { value?: unknown; count?: unknown }

// The changed-vote tally adjustment goes through bumpPollVote's adapter-specific write paths
// (Mongo $inc/upsert vs Postgres ON CONFLICT), so this suite earns cross-DB coverage.
describeForDb(
	'form-builder changeable votes (poll.allowChange)',
	{ dbs: ['mongo', 'postgres'] },
	(db) => {
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
					title: 'Changeable poll',
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

		const rootPostEndpoints = (): Endpoint[] => {
			const endpoints = booted.payload.collections['form-submissions']?.config.endpoints
			if (!endpoints) throw new Error('form-submissions endpoints missing')
			return endpoints.filter((endpoint) => endpoint.method === 'post' && endpoint.path === '/')
		}

		/** Drive the registered root POST endpoint the way handleEndpoints would (custom endpoint first). */
		const submitViaRest = async (
			data: Record<string, unknown>,
			cookieHeader?: string
		): Promise<{ status: number; doc?: { id: number | string }; req: PayloadRequest }> => {
			const [endpoint] = rootPostEndpoints()
			if (!endpoint) throw new Error('no root POST endpoint registered')
			const req = await createLocalReq(
				{ req: { headers: new Headers(cookieHeader ? { cookie: cookieHeader } : {}) } },
				booted.payload
			)
			req.data = data
			req.routeParams = { collection: 'form-submissions' }
			const response = await endpoint.handler(req)
			const body = (await response.json()) as { doc?: { id: number | string } }
			return { status: response.status, doc: body.doc, req }
		}

		const setCookieOf = (req: PayloadRequest): string | null =>
			req.responseHeaders?.get('set-cookie') ?? null

		/** Turn a create/update response's Set-Cookie into the Cookie header of the next request. */
		const asCookieHeader = (setCookie: string): string => {
			const [pair] = setCookie.split(';')
			if (!pair) throw new Error('empty set-cookie')
			return pair.trim()
		}

		const submissionCount = async (formId: number | string): Promise<number> => {
			const { totalDocs } = await booted.payload.count({
				collection: 'form-submissions',
				where: { form: { equals: formId } },
			})
			return totalDocs
		}

		const tallySum = async (formId: number | string, value: string): Promise<number> => {
			const { docs } = await booted.payload.find({
				collection: POLL_VOTES_SLUG,
				overrideAccess: true,
				where: { form: { equals: String(formId) } },
				limit: 100,
				pagination: false,
				depth: 0,
			})
			return (docs as VoteRow[])
				.filter((row) => row.value === value)
				.reduce((sum, row) => sum + (typeof row.count === 'number' ? row.count : 0), 0)
		}

		it('registers the vote-submit endpoint ahead of the stock create', () => {
			const posts = rootPostEndpoints()
			expect(posts).toHaveLength(2)
		})

		it('creates on first vote and sets a signed submission-id cookie', async () => {
			const form = await makeForm()
			const { status, doc, req } = await submitViaRest({
				form: form.id,
				values: [{ field: 'vote', value: 'a' }],
			})
			expect(status).toBe(201)
			if (!doc) throw new Error('expected created doc')
			const setCookie = setCookieOf(req)
			expect(setCookie).toContain(votedCookieName(form.id))
			expect(setCookie).toContain('HttpOnly')
			const parsed = votedSubmissionIdFromCookie(
				asCookieHeader(setCookie ?? ''),
				form.id,
				booted.payload.secret
			)
			expect(parsed).toBe(String(doc.id))
		})

		it('updates the same submission on a cookie-identified re-vote', async () => {
			const form = await makeForm()
			const first = await submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'a' }] })
			const cookie = asCookieHeader(setCookieOf(first.req) ?? '')

			const second = await submitViaRest(
				{ form: form.id, values: [{ field: 'vote', value: 'b' }] },
				cookie
			)
			expect(second.status).toBe(200)
			expect(String(second.doc?.id)).toBe(String(first.doc?.id))
			expect(await submissionCount(form.id)).toBe(1)

			const stored = await booted.payload.findByID({
				collection: 'form-submissions',
				id: first.doc?.id as number | string,
				depth: 0,
			})
			expect(stored.values).toEqual([{ field: 'vote', value: 'b' }])
		})

		it('moves the tally from the old value to the new one, respondents unchanged', async () => {
			const form = await makeForm()
			const first = await submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'a' }] })
			const cookie = asCookieHeader(setCookieOf(first.req) ?? '')
			await submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'b' }] }, cookie)

			expect(await tallySum(form.id, 'a')).toBe(0)
			expect(await tallySum(form.id, 'b')).toBe(1)
			expect(await tallySum(form.id, RESPONDENTS_VALUE)).toBe(1)
		})

		it('leaves the tally alone when the re-vote keeps the same value', async () => {
			const form = await makeForm()
			const first = await submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'a' }] })
			const cookie = asCookieHeader(setCookieOf(first.req) ?? '')
			await submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'a' }] }, cookie)

			expect(await tallySum(form.id, 'a')).toBe(1)
			expect(await tallySum(form.id, RESPONDENTS_VALUE)).toBe(1)
		})

		it('rejects a change once the poll has closed, leaving the tally as voted', async () => {
			const form = await makeForm()
			const first = await submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'a' }] })
			const cookie = asCookieHeader(setCookieOf(first.req) ?? '')

			await booted.payload.update({
				collection: 'forms',
				id: form.id,
				data: { poll: { closesAt: new Date(Date.now() - 60_000).toISOString() } },
			})
			await expect(
				submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'b' }] }, cookie)
			).rejects.toThrow(/closed/i)
			expect(await tallySum(form.id, 'a')).toBe(1)
		})

		it('rejects an invalid changed value and leaves the stored vote and tally intact', async () => {
			const form = await makeForm()
			const first = await submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'a' }] })
			const cookie = asCookieHeader(setCookieOf(first.req) ?? '')

			await expect(
				submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'z' }] }, cookie)
			).rejects.toThrow()
			expect(await tallySum(form.id, 'a')).toBe(1)
			const stored = await booted.payload.findByID({
				collection: 'form-submissions',
				id: first.doc?.id as number | string,
				depth: 0,
			})
			expect(stored.values).toEqual([{ field: 'vote', value: 'a' }])
		})

		it('treats a cookieless repeat submit as a new voter', async () => {
			const form = await makeForm()
			await submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'a' }] })
			const second = await submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'b' }] })
			expect(second.status).toBe(201)
			expect(await submissionCount(form.id)).toBe(2)
			expect(await tallySum(form.id, RESPONDENTS_VALUE)).toBe(2)
		})

		it('ignores a cookie minted for a different form', async () => {
			const formA = await makeForm()
			const formB = await makeForm({ title: 'Other poll' })
			const first = await submitViaRest({ form: formA.id, values: [{ field: 'vote', value: 'a' }] })
			const [pair] = (setCookieOf(first.req) ?? '').split(';')
			const token = (pair ?? '').split('=').slice(1).join('=')

			const cross = await submitViaRest(
				{ form: formB.id, values: [{ field: 'vote', value: 'b' }] },
				`${votedCookieName(formB.id)}=${token}`
			)
			expect(cross.status).toBe(201)
			expect(String(cross.doc?.id)).not.toBe(String(first.doc?.id))
			expect(await submissionCount(formB.id)).toBe(1)
			expect(await submissionCount(formA.id)).toBe(1)
		})

		it('ignores a tampered cookie and votes fresh', async () => {
			const form = await makeForm()
			const first = await submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'a' }] })
			const cookie = asCookieHeader(setCookieOf(first.req) ?? '')
			const forged = `${cookie.slice(0, -2)}ff`

			const second = await submitViaRest(
				{ form: form.id, values: [{ field: 'vote', value: 'b' }] },
				forged
			)
			expect(second.status).toBe(201)
			expect(await submissionCount(form.id)).toBe(2)
		})

		it('falls back to a fresh vote when the identified submission is gone', async () => {
			const form = await makeForm()
			const first = await submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'a' }] })
			const cookie = asCookieHeader(setCookieOf(first.req) ?? '')
			await booted.payload.delete({
				collection: 'form-submissions',
				id: first.doc?.id as number | string,
			})

			const second = await submitViaRest(
				{ form: form.id, values: [{ field: 'vote', value: 'b' }] },
				cookie
			)
			expect(second.status).toBe(201)
			expect(String(second.doc?.id)).not.toBe(String(first.doc?.id))
		})

		it('without allowChange a repeat submit still creates a second submission', async () => {
			const form = await makeForm({
				poll: { resultsField: 'vote', type: 'mostVoted', allowChange: false },
			})
			const first = await submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'a' }] })
			// votedCookie option is off and allowChange is off, so no cookie is set at all.
			expect(setCookieOf(first.req)).toBeNull()
			const second = await submitViaRest({ form: form.id, values: [{ field: 'vote', value: 'b' }] })
			expect(second.status).toBe(201)
			expect(await submissionCount(form.id)).toBe(2)
		})
	}
)
