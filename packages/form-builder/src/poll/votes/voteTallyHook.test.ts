import type { Payload, PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RESPONDENTS_VALUE } from './votesCollection'

const { bumpPollVote } = vi.hoisted(() => ({ bumpPollVote: vi.fn() }))
vi.mock('./bumpPollVote', () => ({ bumpPollVote }))

const { makeVoteTallyHook } = await import('./voteTallyHook')

type FormDoc = { id: string; pollEnabled?: boolean; poll?: { resultsField?: string } }

const findByID = vi.fn()

const makeReq = (transactionID?: number | string): PayloadRequest =>
	({
		payload: { findByID } as unknown as Payload,
		transactionID,
	}) as unknown as PayloadRequest

const pollForm: FormDoc = { id: 'form-1', pollEnabled: true, poll: { resultsField: 'color' } }

const run = (args: {
	doc: Record<string, unknown>
	previousDoc?: Record<string, unknown>
	operation: string
	req: PayloadRequest
}) => makeVoteTallyHook()(args as never) as Promise<unknown>

describe('makeVoteTallyHook', () => {
	beforeEach(() => {
		bumpPollVote.mockReset()
		bumpPollVote.mockResolvedValue(undefined)
		findByID.mockReset()
		findByID.mockResolvedValue(pollForm)
	})

	it('bumps the answer value and the respondents row on a complete create, threading the transaction id', async () => {
		await run({
			doc: {
				id: 's1',
				form: 'form-1',
				status: 'complete',
				values: [{ field: 'color', value: 'red' }],
			},
			operation: 'create',
			req: makeReq('txn-1'),
		})

		expect(bumpPollVote).toHaveBeenCalledTimes(2)
		expect(bumpPollVote).toHaveBeenNthCalledWith(
			1,
			expect.anything(),
			{ form: 'form-1', field: 'color', value: 'red' },
			1,
			'txn-1'
		)
		expect(bumpPollVote).toHaveBeenNthCalledWith(
			2,
			expect.anything(),
			{ form: 'form-1', field: 'color', value: RESPONDENTS_VALUE },
			1,
			'txn-1'
		)
	})

	it('bumps once when an update transitions partial to complete', async () => {
		await run({
			doc: {
				id: 's1',
				form: 'form-1',
				status: 'complete',
				values: [{ field: 'color', value: 'blue' }],
			},
			previousDoc: { id: 's1', form: 'form-1', status: 'partial' },
			operation: 'update',
			req: makeReq(),
		})

		expect(bumpPollVote).toHaveBeenCalledTimes(2)
	})

	it('does not bump on a re-save while already complete', async () => {
		await run({
			doc: {
				id: 's1',
				form: 'form-1',
				status: 'complete',
				values: [{ field: 'color', value: 'blue' }],
			},
			previousDoc: { id: 's1', form: 'form-1', status: 'complete' },
			operation: 'update',
			req: makeReq(),
		})

		expect(bumpPollVote).not.toHaveBeenCalled()
	})

	it('does not bump when an update stays partial', async () => {
		await run({
			doc: {
				id: 's1',
				form: 'form-1',
				status: 'partial',
				values: [{ field: 'color', value: 'blue' }],
			},
			previousDoc: { id: 's1', form: 'form-1', status: 'partial' },
			operation: 'update',
			req: makeReq(),
		})

		expect(bumpPollVote).not.toHaveBeenCalled()
	})

	it('does not bump and does not throw when the form has no pollEnabled', async () => {
		findByID.mockResolvedValue({ id: 'form-1', pollEnabled: false })

		await run({
			doc: {
				id: 's1',
				form: 'form-1',
				status: 'complete',
				values: [{ field: 'color', value: 'blue' }],
			},
			operation: 'create',
			req: makeReq(),
		})

		expect(bumpPollVote).not.toHaveBeenCalled()
	})

	it('does not bump and does not throw when pollEnabled but resultsField is missing', async () => {
		findByID.mockResolvedValue({ id: 'form-1', pollEnabled: true, poll: {} })

		await run({
			doc: {
				id: 's1',
				form: 'form-1',
				status: 'complete',
				values: [{ field: 'color', value: 'blue' }],
			},
			operation: 'create',
			req: makeReq(),
		})

		expect(bumpPollVote).not.toHaveBeenCalled()
	})

	it('does not bump and does not throw when the form relationship is missing', async () => {
		await run({
			doc: {
				id: 's1',
				form: null,
				status: 'complete',
				values: [{ field: 'color', value: 'blue' }],
			},
			operation: 'create',
			req: makeReq(),
		})

		expect(bumpPollVote).not.toHaveBeenCalled()
		expect(findByID).not.toHaveBeenCalled()
	})

	it('bumps one tally per non-empty array entry plus one respondents row', async () => {
		await run({
			doc: {
				id: 's1',
				form: 'form-1',
				status: 'complete',
				values: [{ field: 'color', value: ['red', 'blue'] }],
			},
			operation: 'create',
			req: makeReq(),
		})

		expect(bumpPollVote).toHaveBeenCalledTimes(3)
		expect(bumpPollVote).toHaveBeenNthCalledWith(
			1,
			expect.anything(),
			{ form: 'form-1', field: 'color', value: 'red' },
			1,
			undefined
		)
		expect(bumpPollVote).toHaveBeenNthCalledWith(
			2,
			expect.anything(),
			{ form: 'form-1', field: 'color', value: 'blue' },
			1,
			undefined
		)
		expect(bumpPollVote).toHaveBeenNthCalledWith(
			3,
			expect.anything(),
			{ form: 'form-1', field: 'color', value: RESPONDENTS_VALUE },
			1,
			undefined
		)
	})

	it('does not bump for an empty-string or null answer', async () => {
		await run({
			doc: {
				id: 's1',
				form: 'form-1',
				status: 'complete',
				values: [{ field: 'color', value: '' }],
			},
			operation: 'create',
			req: makeReq(),
		})
		expect(bumpPollVote).not.toHaveBeenCalled()

		await run({
			doc: {
				id: 's2',
				form: 'form-1',
				status: 'complete',
				values: [{ field: 'color', value: null }],
			},
			operation: 'create',
			req: makeReq(),
		})
		expect(bumpPollVote).not.toHaveBeenCalled()
	})

	it('propagates a bump rejection so the enclosing transaction rolls back', async () => {
		bumpPollVote.mockRejectedValue(new Error('write failed'))

		await expect(
			run({
				doc: {
					id: 's1',
					form: 'form-1',
					status: 'complete',
					values: [{ field: 'color', value: 'red' }],
				},
				operation: 'create',
				req: makeReq(),
			})
		).rejects.toThrow('write failed')
	})

	it('leaves delete (and other) operations untouched', async () => {
		await run({
			doc: {
				id: 's1',
				form: 'form-1',
				status: 'complete',
				values: [{ field: 'color', value: 'red' }],
			},
			operation: 'delete',
			req: makeReq(),
		})

		expect(bumpPollVote).not.toHaveBeenCalled()
		expect(findByID).not.toHaveBeenCalled()
	})
})
