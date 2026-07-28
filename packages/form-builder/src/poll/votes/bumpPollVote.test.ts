import type { Payload } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpPollVote } from './bumpPollVote'
import { POLL_VOTES_SLUG } from './votesCollection'

vi.mock('@payloadcms/db-postgres', () => ({
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }),
}))

const key = { form: 'form-1', field: 'color', value: 'red' }

type UpdateOneMock = ReturnType<typeof vi.fn>

const makeMongoPayload = (args?: {
	sessions?: Record<number | string, unknown>
	withoutModel?: boolean
}): { payload: Payload; updateOne: UpdateOneMock } => {
	const updateOne = vi.fn().mockResolvedValue({})
	const db = {
		name: 'mongoose',
		collections: args?.withoutModel ? {} : { [POLL_VOTES_SLUG]: { collection: { updateOne } } },
		sessions: args?.sessions,
	}
	return { payload: { db } as unknown as Payload, updateOne }
}

type PgInsertChain = {
	insert: ReturnType<typeof vi.fn>
	values: ReturnType<typeof vi.fn>
	onConflictDoUpdate: ReturnType<typeof vi.fn>
}

const makeInsertChain = (): PgInsertChain => {
	const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
	const values = vi.fn().mockReturnValue({ onConflictDoUpdate })
	const insert = vi.fn().mockReturnValue({ values })
	return { insert, values, onConflictDoUpdate }
}

const pgTable = {
	form: { column: 'form' },
	field: { column: 'field' },
	value: { column: 'value' },
	count: { column: 'count' },
}

const makePgPayload = (args?: {
	sessions?: Record<number | string, { db: { insert: PgInsertChain['insert'] } }>
	tableNameMap?: Map<string, string>
	tables?: Record<string, Record<string, unknown>>
}): { payload: Payload; root: PgInsertChain } => {
	const root = makeInsertChain()
	const db = {
		name: 'postgres',
		drizzle: { insert: root.insert },
		sessions: args?.sessions,
		tableNameMap: args?.tableNameMap ?? new Map([['form_poll_votes', 'form_poll_votes']]),
		tables: args?.tables ?? { form_poll_votes: pgTable },
	}
	return { payload: { db } as unknown as Payload, root }
}

describe('bumpPollVote', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('mongoose', () => {
		it('upserts with $inc and $setOnInsert joined to the matching session', async () => {
			const session = { id: 'client-session' }
			const { payload, updateOne } = makeMongoPayload({ sessions: { 'txn-1': session } })

			await bumpPollVote(payload, key, 2, 'txn-1')

			expect(updateOne).toHaveBeenCalledWith(
				key,
				{ $inc: { count: 2 }, $setOnInsert: key },
				{ upsert: true, session }
			)
		})

		it('joins the session when the transaction id is numeric', async () => {
			const session = { id: 'numeric-session' }
			const { payload, updateOne } = makeMongoPayload({ sessions: { 7: session } })

			await bumpPollVote(payload, key, 1, 7)

			expect(updateOne).toHaveBeenCalledWith(key, expect.anything(), {
				upsert: true,
				session,
			})
		})

		it('omits session when no transaction id is given', async () => {
			const { payload, updateOne } = makeMongoPayload({ sessions: { 'txn-1': {} } })

			await bumpPollVote(payload, key, 1)

			expect(updateOne).toHaveBeenCalledWith(key, expect.anything(), { upsert: true })
			expect(updateOne.mock.calls[0]?.[2]).not.toHaveProperty('session')
		})

		it('omits session when the transaction id has no session', async () => {
			const { payload, updateOne } = makeMongoPayload({ sessions: {} })

			await bumpPollVote(payload, key, 1, 'unknown-txn')

			expect(updateOne).toHaveBeenCalledWith(key, expect.anything(), { upsert: true })
		})

		it('omits session when the adapter has no sessions map', async () => {
			const { payload, updateOne } = makeMongoPayload()

			await bumpPollVote(payload, key, 1, 'txn-1')

			expect(updateOne).toHaveBeenCalledWith(key, expect.anything(), { upsert: true })
		})

		it('throws a clear error naming the collection when the model is missing', async () => {
			const { payload } = makeMongoPayload({ withoutModel: true })

			await expect(bumpPollVote(payload, key, 1)).rejects.toThrow(POLL_VOTES_SLUG)
		})
	})

	describe('postgres', () => {
		it('inserts on the transaction drizzle with onConflictDoUpdate increment', async () => {
			const txn = makeInsertChain()
			const { payload, root } = makePgPayload({
				sessions: { 'txn-1': { db: { insert: txn.insert } } },
			})

			await bumpPollVote(payload, key, 3, 'txn-1')

			expect(root.insert).not.toHaveBeenCalled()
			expect(txn.insert).toHaveBeenCalledWith(pgTable)
			expect(txn.values).toHaveBeenCalledWith({ ...key, count: 3 })
			expect(txn.onConflictDoUpdate).toHaveBeenCalledWith({
				target: [pgTable.form, pgTable.field, pgTable.value],
				set: { count: expect.objectContaining({ values: [pgTable.count, 3] }) },
			})
		})

		it('uses the transaction drizzle for a numeric transaction id', async () => {
			const txn = makeInsertChain()
			const { payload, root } = makePgPayload({ sessions: { 42: { db: { insert: txn.insert } } } })

			await bumpPollVote(payload, key, 1, 42)

			expect(root.insert).not.toHaveBeenCalled()
			expect(txn.insert).toHaveBeenCalledWith(pgTable)
		})

		it('falls back to the root drizzle without a transaction', async () => {
			const { payload, root } = makePgPayload()

			await bumpPollVote(payload, key, 1)

			expect(root.insert).toHaveBeenCalledWith(pgTable)
			expect(root.values).toHaveBeenCalledWith({ ...key, count: 1 })
		})

		it('falls back to the root drizzle for an unknown transaction id', async () => {
			const { payload, root } = makePgPayload({ sessions: {} })

			await bumpPollVote(payload, key, 1, 'unknown-txn')

			expect(root.insert).toHaveBeenCalledWith(pgTable)
		})

		it('throws when the table name is missing from tableNameMap', async () => {
			const { payload } = makePgPayload({ tableNameMap: new Map() })

			await expect(bumpPollVote(payload, key, 1)).rejects.toThrow('form_poll_votes')
		})

		it('throws when the table object is missing', async () => {
			const { payload } = makePgPayload({ tables: {} })

			await expect(bumpPollVote(payload, key, 1)).rejects.toThrow('form_poll_votes')
		})
	})
})
