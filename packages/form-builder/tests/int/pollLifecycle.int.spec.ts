import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { createLocalReq, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
	type FormResultsAccess,
	resolveFormResultsRequest,
} from '../../src/aggregation/resolveResultsRequest'
import { formBuilder } from '../../src/index'

const past = () => new Date(Date.now() - 60_000).toISOString()
const future = () => new Date(Date.now() + 60 * 60_000).toISOString()

const DENY_TITLE = 'Denied poll'

const access: FormResultsAccess = ({ form }) => form.title !== DENY_TITLE

describeForDb('form-builder poll lifecycle', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({ poll: { votedCookie: true }, results: { access } }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const makeForm = async (over: Record<string, unknown>) =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Poll',
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
				...over,
			},
		})

	const vote = async (formId: number | string, opts?: { req?: PayloadRequest }) =>
		booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: { form: formId, values: [{ field: 'colour', value: 'red' }] },
			...(opts?.req ? { req: opts.req } : {}),
		})

	it('rejects a submission once closesAt has passed', async () => {
		const form = await makeForm({
			pollEnabled: true,
			poll: { resultsField: 'colour', closesAt: past() },
		})
		await expect(vote(form.id)).rejects.toThrow(/closed/i)
	})

	it('accepts a submission while the poll is still open', async () => {
		const form = await makeForm({
			pollEnabled: true,
			poll: { resultsField: 'colour', closesAt: future() },
		})
		const submission = await vote(form.id)
		expect(submission.id).toBeDefined()
	})

	it('ignores a past closesAt when the poll is not enabled', async () => {
		const form = await makeForm({
			pollEnabled: false,
			poll: { resultsField: 'colour', closesAt: past() },
		})
		const submission = await vote(form.id)
		expect(submission.id).toBeDefined()
	})

	it('sets the httpOnly voted cookie on a poll submission create', async () => {
		const form = await makeForm({ pollEnabled: true, poll: { resultsField: 'colour' } })
		const req = await createLocalReq({}, booted.payload)
		await vote(form.id, { req })
		const cookie = req.responseHeaders?.get('set-cookie')
		expect(cookie).toContain(`fb-voted-${form.id}=1`)
		expect(cookie).toContain('HttpOnly')
		expect(cookie).toContain('SameSite=Lax')
	})

	it('sets no cookie for a non-poll form', async () => {
		const form = await makeForm({})
		const req = await createLocalReq({}, booted.payload)
		await vote(form.id, { req })
		expect(req.responseHeaders?.get('set-cookie') ?? null).toBeNull()
	})

	it('access seam: allows an anonymous read when the host grants it', async () => {
		const form = await makeForm({ pollEnabled: true, poll: { resultsField: 'colour' } })
		await vote(form.id)
		const req = await createLocalReq({}, booted.payload)
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
			req,
			access,
		})
		expect(res.status).toBe(200)
	})

	it('access seam: forbids an anonymous read when the host denies it', async () => {
		const form = await makeForm({
			title: DENY_TITLE,
			pollEnabled: true,
			poll: { resultsField: 'colour' },
		})
		const req = await createLocalReq({}, booted.payload)
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
			req,
			access,
		})
		expect(res.status).toBe(403)
	})

	it('access seam: authed callers bypass the seam', async () => {
		const form = await makeForm({
			title: DENY_TITLE,
			pollEnabled: true,
			poll: { resultsField: 'colour' },
		})
		const req = await createLocalReq({}, booted.payload)
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: true,
			req,
			access,
		})
		expect(res.status).toBe(200)
	})

	it('access seam: fails closed for an anonymous read without a req', async () => {
		const form = await makeForm({ pollEnabled: true, poll: { resultsField: 'colour' } })
		const res = await resolveFormResultsRequest({
			payload: booted.payload,
			formId: form.id,
			isAuthed: false,
			access,
		})
		expect(res.status).toBe(403)
	})
})
