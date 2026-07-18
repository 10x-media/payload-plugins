import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { resolveFormResultsRequest } from '../../src/aggregation/resolveResultsRequest'
import { formBuilder } from '../../src/index'

const past = () => new Date(Date.now() - 60_000).toISOString()
const future = () => new Date(Date.now() + 60 * 60_000).toISOString()

describeForDb('form-builder poll results gating', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
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
					{ blockType: 'text', name: 'note', label: 'Note' },
				],
				...over,
			},
		})

	const vote = async (formId: number | string, value: string) =>
		booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: { form: formId, values: [{ field: 'colour', value }] },
		})

	const request = async (formId: number | string, opts?: { field?: string; isAuthed?: boolean }) =>
		resolveFormResultsRequest({
			payload: booted.payload,
			formId,
			field: opts?.field,
			isAuthed: opts?.isAuthed ?? false,
		})

	it('afterVote + open: serves public results anonymously', async () => {
		const form = await makeForm({ pollEnabled: true, poll: { resultsField: 'colour' } })
		await vote(form.id, 'red')
		await vote(form.id, 'blue')
		const res = await request(form.id, { field: 'colour' })
		expect(res.status).toBe(200)
		expect('results' in res.body && res.body.results[0]?.total).toBe(2)
	})

	it('afterVote + closed: still serves results anonymously', async () => {
		const form = await makeForm({
			pollEnabled: true,
			poll: {
				resultsField: 'colour',
				resultsVisibility: 'afterVote',
				closesAt: past(),
			},
		})
		const res = await request(form.id)
		expect(res.status).toBe(200)
	})

	it('afterClose + open: forbids anonymous results until closesAt passes', async () => {
		const form = await makeForm({
			pollEnabled: true,
			poll: {
				resultsField: 'colour',
				resultsVisibility: 'afterClose',
				closesAt: future(),
			},
		})
		const res = await request(form.id)
		expect(res.status).toBe(403)
	})

	it('afterClose without a closesAt: forbids anonymous results', async () => {
		const form = await makeForm({
			pollEnabled: true,
			poll: { resultsField: 'colour', resultsVisibility: 'afterClose' },
		})
		const res = await request(form.id)
		expect(res.status).toBe(403)
	})

	it('afterClose + closed: serves results anonymously', async () => {
		const form = await makeForm({
			pollEnabled: true,
			poll: {
				resultsField: 'colour',
				resultsVisibility: 'afterClose',
				closesAt: past(),
			},
		})
		const res = await request(form.id)
		expect(res.status).toBe(200)
	})

	it('forbids anonymous results when the poll is not enabled', async () => {
		const form = await makeForm({})
		await vote(form.id, 'red')
		const res = await request(form.id, { field: 'colour' })
		expect(res.status).toBe(403)
	})

	it('forbids anonymous results when only resultsField is set but the poll is disabled', async () => {
		const form = await makeForm({ pollEnabled: false, poll: { resultsField: 'colour' } })
		const res = await request(form.id)
		expect(res.status).toBe(403)
	})

	it('forbids an anonymous request for a field other than the public one', async () => {
		const form = await makeForm({ pollEnabled: true, poll: { resultsField: 'colour' } })
		const res = await request(form.id, { field: 'note' })
		expect(res.status).toBe(403)
	})

	// The resultsField validate refuses to store a non-eligible field, so misconfigured polls are
	// planted below Payload (payload.db) to prove the endpoint guard holds for pre-existing docs.
	const plantPoll = async (formId: number | string, poll: Record<string, unknown>) =>
		booted.payload.db.updateOne({ collection: 'forms', id: formId, data: { poll } })

	it('rejects saving a resultsField that names a non-eligible or unknown field', async () => {
		await expect(makeForm({ pollEnabled: true, poll: { resultsField: 'note' } })).rejects.toThrow()
		await expect(makeForm({ pollEnabled: true, poll: { resultsField: 'ghost' } })).rejects.toThrow()
	})

	it('accepts a stale resultsField while the poll is disabled (validation follows the condition)', async () => {
		const form = await makeForm({ pollEnabled: false, poll: { resultsField: 'ghost' } })
		expect(form.id).toBeDefined()
	})

	it('forbids anonymous results when the public field is not enumerable (PII guard)', async () => {
		const form = await makeForm({ pollEnabled: true, poll: { resultsField: 'colour' } })
		await plantPoll(form.id, { resultsField: 'note' })
		const res = await request(form.id)
		expect(res.status).toBe(403)
	})

	it('forbids anonymous results for a closed poll whose field is not enumerable (PII guard survives close)', async () => {
		const form = await makeForm({ pollEnabled: true, poll: { resultsField: 'colour' } })
		await plantPoll(form.id, {
			resultsField: 'note',
			resultsVisibility: 'afterClose',
			closesAt: past(),
		})
		const res = await request(form.id)
		expect(res.status).toBe(403)
	})

	it('allows an authed caller to aggregate any field', async () => {
		const form = await makeForm({})
		await vote(form.id, 'red')
		const res = await request(form.id, { field: 'colour', isAuthed: true })
		expect(res.status).toBe(200)
		expect('results' in res.body && res.body.results[0]?.total).toBe(1)
	})

	it('allows an authed caller before an afterClose poll closes', async () => {
		const form = await makeForm({
			pollEnabled: true,
			poll: {
				resultsField: 'colour',
				resultsVisibility: 'afterClose',
				closesAt: future(),
			},
		})
		const res = await request(form.id, { field: 'colour', isAuthed: true })
		expect(res.status).toBe(200)
	})

	it('404s an unknown form', async () => {
		const res = await request(999999, { isAuthed: true })
		expect(res.status).toBe(404)
	})

	// winningValues carries no field-level access (admins edit it), so Payload's loggedIn default on
	// the collection is what blocks anonymous writes. This boot has no access overrides, proving
	// the unlock still rides that gate.
	it('default access gates outcome writes to authenticated callers', async () => {
		const form = await makeForm({ pollEnabled: true, poll: { resultsField: 'colour' } })
		await expect(
			booted.payload.update({
				collection: 'forms',
				id: form.id,
				data: { poll: { outcome: { winningValues: ['red'] } } },
				depth: 0,
				overrideAccess: false,
			})
		).rejects.toThrow(/not allowed/i)

		const updated = await booted.payload.update({
			collection: 'forms',
			id: form.id,
			data: { poll: { outcome: { winningValues: ['red'] } } },
			depth: 0,
			overrideAccess: true,
		})
		const outcome = (
			updated.poll as { outcome?: { winningValues?: string[]; resolvedAt?: string } }
		).outcome
		expect(outcome?.winningValues).toEqual(['red'])
		expect(outcome?.resolvedAt).toBeTruthy()
	})
})
