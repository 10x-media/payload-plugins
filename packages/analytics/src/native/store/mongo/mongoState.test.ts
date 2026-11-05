import { describe, expect, it } from 'vitest'
import { isMongoStateModel, type MongoStateModel, mongoStateStore } from './mongoState'

const NOW = new Date('2026-10-06T12:00:00.000Z')
const MINUTE = 60_000

interface Call {
	method: string
	args: unknown[]
}

const duplicateKey = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })

/** A model that records every call and answers what `answer` returns for it, or null. */
const fakeModel = (answer: (call: Call, seen: number) => unknown = () => null) => {
	const calls: Call[] = []
	const record =
		(method: string) =>
		async (...args: unknown[]): Promise<unknown> => {
			const call = { method, args }
			calls.push(call)
			const result = answer(call, calls.length)
			if (result instanceof Error) {
				throw result
			}
			return result
		}
	const model: MongoStateModel = {
		findOneAndUpdate: record('findOneAndUpdate'),
		updateMany: record('updateMany'),
		find: record('find'),
		findOne: record('findOne'),
		deleteMany: record('deleteMany'),
		deleteOne: record('deleteOne'),
		bulkWrite: record('bulkWrite'),
		distinct: record('distinct'),
	}
	return { model, calls }
}

describe('mongoStateStore leases', () => {
	it('claims a lease key in one conditional upsert, stamped from its clock', async () => {
		const { model, calls } = fakeModel(() => ({ _id: 'lease:maintain' }))
		const store = mongoStateStore(() => model, { now: () => NOW })
		await expect(store.claim('lease:maintain', 'run-1', 10 * MINUTE)).resolves.toBe(true)
		expect(calls).toEqual([
			{
				method: 'findOneAndUpdate',
				args: [
					{
						_id: 'lease:maintain',
						$or: [{ leaseUntil: null }, { leaseUntil: { $lt: NOW } }, { leaseOwner: 'run-1' }],
					},
					{
						$set: { leaseOwner: 'run-1', leaseUntil: new Date('2026-10-06T12:10:00.000Z') },
						$setOnInsert: { kind: 'lease', scope: '' },
					},
					{ lean: true, new: true, upsert: true },
				],
			},
		])
	})

	it('loses a held lease to the duplicate key its upsert runs into', async () => {
		const { model } = fakeModel(() => duplicateKey())
		await expect(
			mongoStateStore(() => model, { now: () => NOW }).claim('lease:maintain', 'run-2', MINUTE)
		).resolves.toBe(false)
	})

	it('claims a day marker without upserting, so a missing marker wins nothing', async () => {
		const { model, calls } = fakeModel()
		await expect(
			mongoStateStore(() => model, { now: () => NOW }).claim('day:a:20261005', 'run-1', MINUTE)
		).resolves.toBe(false)
		expect(calls[0]?.args[2]).toEqual({ lean: true, new: true })
	})

	it('completes only on the lease its owner still holds, and clears it', async () => {
		const { model, calls } = fakeModel()
		const store = mongoStateStore(() => model, { now: () => NOW })
		await expect(
			store.complete(
				{
					scope: 'a',
					day: 20261005,
					tz: 'UTC',
					start: null,
					status: 'final',
					version: 1,
					gen: 'run-1',
					hits: 3,
					leaseOwner: 'run-1',
					leaseUntil: null,
					finalAfter: null,
					aggregatedAt: NOW,
				},
				'run-1'
			)
		).resolves.toBe(false)
		expect(calls[0]?.args[0]).toEqual({ _id: 'day:a:20261005', leaseOwner: 'run-1' })
		expect(calls[0]?.args[1]).toMatchObject({
			$set: { value: null, leaseOwner: null, leaseUntil: null },
		})
	})

	it('records where a completed day’s count started, when not at its own start', async () => {
		const { model, calls } = fakeModel()
		await mongoStateStore(() => model, { now: () => NOW }).complete(
			{
				scope: 'a',
				day: 20261005,
				tz: 'Asia/Tokyo',
				start: new Date('2026-10-05T00:00:00.000Z'),
				status: 'final',
				version: 1,
				gen: 'run-1',
				hits: 3,
				leaseOwner: 'run-1',
				leaseUntil: null,
				finalAfter: null,
				aggregatedAt: NOW,
			},
			'run-1'
		)
		expect(calls[0]?.args[1]).toMatchObject({
			$set: { tz: 'Asia/Tokyo', value: { start: '2026-10-05T00:00:00.000Z' } },
		})
	})

	it('revokes the lease of a day it marks dirty, and forgets its failures', async () => {
		const { model, calls } = fakeModel()
		await mongoStateStore(() => model).markDirty('a', [20261005, 20261005])
		expect(calls).toEqual([
			{
				method: 'updateMany',
				args: [
					{ _id: { $in: ['day:a:20261005'] }, kind: 'day' },
					{
						$set: { status: 'dirty', leaseOwner: null, leaseUntil: null },
						$unset: { 'value.failures': '' },
					},
				],
			},
		])
	})

	it('renews a lease only for the owner still holding it, expired or not', async () => {
		const { model, calls } = fakeModel(() => null)
		await expect(
			mongoStateStore(() => model, { now: () => NOW }).renew('day:a:20261005', 'run-1', MINUTE)
		).resolves.toBe(false)
		expect(calls).toEqual([
			{
				method: 'findOneAndUpdate',
				args: [
					{ _id: 'day:a:20261005', leaseOwner: 'run-1' },
					{ $set: { leaseUntil: new Date(NOW.getTime() + MINUTE) } },
					{ lean: true, new: true },
				],
			},
		])
	})
})

describe('mongoStateStore salts, markers and heartbeats', () => {
	it('upserts a salt and answers the stored one, retrying once after a lost insert race', async () => {
		const { model, calls } = fakeModel((_call, seen) =>
			seen === 1 ? duplicateKey() : { _id: 'salt:2026-10-05', value: 'kept' }
		)
		await expect(mongoStateStore(() => model).salt(20261005)).resolves.toBe('kept')
		expect(calls).toHaveLength(2)
		expect(calls[0]?.args[0]).toEqual({ _id: 'salt:2026-10-05' })
		expect(calls[0]?.args[1]).toMatchObject({
			$setOnInsert: {
				kind: 'salt',
				scope: '',
				day: 20261005,
				expiresAt: new Date('2026-10-08T00:00:00.000Z'),
			},
		})
	})

	it('gives up after one retry', async () => {
		const { model, calls } = fakeModel(() => duplicateKey())
		await expect(mongoStateStore(() => model).salt(20261005)).rejects.toThrow('E11000')
		expect(calls).toHaveLength(2)
	})

	it('creates missing markers with insert-only upserts, a lost race being no failure', async () => {
		const { model, calls } = fakeModel(() =>
			Object.assign(new Error('bulk'), { writeErrors: [{ code: 11000 }] })
		)
		await mongoStateStore(() => model).ensureMarkers([{ scope: 'a', day: 20261005, tz: 'UTC' }])
		expect(calls[0]?.args).toEqual([
			[
				{
					updateOne: {
						filter: { _id: 'day:a:20261005' },
						update: {
							$setOnInsert: {
								kind: 'day',
								scope: 'a',
								day: 20261005,
								tz: 'UTC',
								status: 'open',
								finalAfter: new Date('2026-10-07T00:15:00.000Z'),
							},
						},
						upsert: true,
					},
				},
			],
			{ ordered: false },
		])
	})

	it('reads a scope markers off its (kind, scope, day) index however long, oldest day first', async () => {
		const { model, calls } = fakeModel(() => [
			{ _id: 'day:a:20261006', scope: 'a', day: 20261006, tz: 'UTC', status: 'open' },
			{ _id: 'day:a:20261005', scope: 'a', day: 20261005, tz: 'UTC', status: 'final' },
		])
		const markers = await mongoStateStore(() => model).markers('a', 19700101, 20261007)
		expect(markers.map((marker) => [marker.day, marker.status])).toEqual([
			[20261005, 'final'],
			[20261006, 'open'],
		])
		expect(calls).toEqual([
			{
				method: 'find',
				args: [
					{ kind: 'day', scope: 'a', day: { $gte: 19700101, $lte: 20261007 } },
					null,
					{ lean: true, sort: { day: 1 } },
				],
			},
		])
		await expect(mongoStateStore(() => model).markers('a', 20261007, 20261001)).resolves.toEqual([])
		expect(calls).toHaveLength(1)
	})

	it('selects due markers oldest first, the instants taken from the one it was given', async () => {
		const { model, calls } = fakeModel(() => [
			{ _id: 'day:b:20261004', scope: 'b', day: 20261004, tz: 'UTC', status: 'dirty' },
			{ _id: 'day:a:20261005', scope: 'a', day: 20261005, tz: 'UTC', status: 'bogus' },
		])
		const due = await mongoStateStore(() => model, { now: () => new Date(0) }).pending(NOW, 10)
		expect(due.map((marker) => marker.scope)).toEqual(['b'])
		expect(calls[0]?.args).toEqual([
			{
				kind: 'day',
				$and: [
					{ $or: [{ leaseUntil: null }, { leaseUntil: { $lt: NOW } }] },
					{
						$or: [
							{ status: 'dirty' },
							{
								status: { $in: ['open', 'partial'] },
								finalAfter: { $lte: new Date('2026-10-07T12:00:00.000Z') },
							},
							{ status: 'provisional', finalAfter: { $lte: NOW } },
						],
					},
				],
			},
			null,
			{ lean: true, sort: { day: 1, scope: 1 }, limit: 10 },
		])
	})

	it('sweeps expired salts, answering how many went', async () => {
		const { model, calls } = fakeModel(() => ({ acknowledged: true, deletedCount: 2 }))
		await expect(mongoStateStore(() => model).sweep(NOW)).resolves.toBe(2)
		expect(calls[0]?.args).toEqual([{ kind: 'salt', expiresAt: { $lte: NOW } }])
	})

	it('drops a scope’s day markers before a day, answering how many went', async () => {
		const { model, calls } = fakeModel(() => ({ acknowledged: true, deletedCount: 5 }))
		await expect(mongoStateStore(() => model).dropMarkers('a', 20260701)).resolves.toBe(5)
		expect(calls[0]).toEqual({
			method: 'deleteMany',
			args: [{ kind: 'day', scope: 'a', day: { $lt: 20260701 } }],
		})
		const silent = fakeModel(() => ({}))
		await expect(mongoStateStore(() => silent.model).dropMarkers('a', 20260701)).resolves.toBe(0)
	})

	it('upserts a heartbeat and reads it back', async () => {
		const { model, calls } = fakeModel((call) =>
			call.method === 'findOne' ? { value: { at: '2026-10-06T12:00:00.000Z' } } : {}
		)
		const store = mongoStateStore(() => model, { now: () => NOW })
		await store.beat('analytics-maintain')
		expect(calls[0]?.args[1]).toEqual({
			$set: { value: { at: '2026-10-06T12:00:00.000Z' } },
			$setOnInsert: { kind: 'heartbeat', scope: '' },
		})
		expect((await store.lastBeat('analytics-maintain'))?.toISOString()).toBe(
			'2026-10-06T12:00:00.000Z'
		)
	})

	it('upserts a scope’s configuration token and reads it back', async () => {
		const { model, calls } = fakeModel((call) =>
			call.method === 'findOne' ? { value: { token: 't-1' } } : {}
		)
		const store = mongoStateStore(() => model, { now: () => NOW })
		await store.setConfigToken('tenant-a', 't-1')
		expect(calls[0]?.args.slice(0, 2)).toEqual([
			{ _id: 'epoch:tenant-a' },
			{ $set: { value: { token: 't-1' } }, $setOnInsert: { kind: 'epoch', scope: 'tenant-a' } },
		])
		await expect(store.configToken('tenant-a')).resolves.toBe('t-1')
		const empty = fakeModel(() => null)
		await expect(mongoStateStore(() => empty.model).configToken('')).resolves.toBeNull()
	})

	it('upserts where a task’s run stopped and reads it back, null once it finished', async () => {
		const { model, calls } = fakeModel((call) =>
			call.method === 'findOne' ? { value: { cursor: null } } : {}
		)
		const store = mongoStateStore(() => model, { now: () => NOW })
		await store.setCursor('analytics-sync', null)
		expect(calls[0]?.args.slice(0, 2)).toEqual([
			{ _id: 'cursor:analytics-sync' },
			{ $set: { value: { cursor: null } }, $setOnInsert: { kind: 'cursor', scope: '' } },
		])
		await expect(store.cursor('analytics-sync')).resolves.toBeNull()
	})

	it('completes a clean marker only while the day is not dirty', async () => {
		const { model, calls } = fakeModel()
		const store = mongoStateStore(() => model, { now: () => NOW })
		await store.complete(
			{
				scope: 'a',
				day: 20261005,
				tz: 'UTC',
				start: null,
				status: 'empty',
				version: 1,
				gen: null,
				hits: 0,
				leaseOwner: 'run-1',
				leaseUntil: null,
				finalAfter: null,
				aggregatedAt: NOW,
			},
			'run-1',
			{ clean: true }
		)
		expect(calls[0]?.args[0]).toEqual({
			_id: 'day:a:20261005',
			leaseOwner: 'run-1',
			status: { $ne: 'dirty' },
		})
	})

	it('recognizes a model by the methods it calls', () => {
		expect(isMongoStateModel(fakeModel().model)).toBe(true)
		expect(isMongoStateModel({ find: () => null })).toBe(false)
	})
})
