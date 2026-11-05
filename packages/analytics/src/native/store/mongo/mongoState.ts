import { randomBytes } from 'node:crypto'
import { currentDate } from '../../../core/clock'
import { hasMethods, isRecord } from '../../../core/values'
import { isUniqueViolation } from '../../../db/errors'
import { chunksOf } from '../chunks'
import { dateOf } from '../columnValues'
import { compareCodePoints } from '../rawRead'
import {
	atOf,
	checkStateLimit,
	cursorKey,
	cursorOf,
	dayFinalAfter,
	dayKey,
	dropKey,
	dropOf,
	epochStateKey,
	heartbeatKey,
	leaseUntilFrom,
	markersOf,
	markerValue,
	openDueBy,
	prunedKey,
	saltExpiresAt,
	saltKey,
	stateKindOf,
	tokenOf,
} from '../state'
import type { DayMarker, DropNote, StateStore, StateStoreOptions } from '../types'
import { deletedOf, distinctStrings, foundDocuments } from './results'

/**
 * The slice of a mongoose model the state store calls: `payload.db.collections[slug]`, the model
 * Payload's Mongo adapter compiled for the collection. Queries resolve as thenables.
 */
export interface MongoStateModel {
	findOneAndUpdate(filter: object, update: object, options: object): PromiseLike<unknown>
	updateMany(filter: object, update: object): PromiseLike<unknown>
	find(filter: object, projection: object | null, options: object): PromiseLike<unknown>
	findOne(filter: object, projection: object | null, options: object): PromiseLike<unknown>
	deleteMany(filter: object): PromiseLike<unknown>
	deleteOne(filter: object): PromiseLike<unknown>
	bulkWrite(operations: object[], options: object): PromiseLike<unknown>
	distinct(field: string, filter: object): PromiseLike<unknown>
}

const MODEL_METHODS: ReadonlyArray<keyof MongoStateModel> = [
	'findOneAndUpdate',
	'updateMany',
	'find',
	'findOne',
	'deleteMany',
	'deleteOne',
	'bulkWrite',
	'distinct',
]

export const isMongoStateModel = (value: unknown): value is MongoStateModel =>
	hasMethods(value, MODEL_METHODS)

/** Keys one `$in` or one bulk write carries, as the SQL state store chunks its statements. */
const CHUNK = 500

/** Answer the document as it is after the update, as a plain object. */
const AFTER = { lean: true, new: true }

/** A lease free for `owner` at `now`: never taken, expired, or `owner`'s own. */
const leaseFree = (now: Date, owner: string): object => ({
	$or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }, { leaseOwner: owner }],
})

/** One retry of an upsert that lost a race to insert the same `_id`: the retry finds that row. */
const upsertRetrying = async (upsert: () => PromiseLike<unknown>): Promise<unknown> => {
	try {
		return await upsert()
	} catch (err) {
		if (!isUniqueViolation(err)) {
			throw err
		}
		return upsert()
	}
}

/**
 * The state store on MongoDB, never in the host's session; its model looked up per call, as a dev
 * reload compiles new ones on the same connection and drops the old.
 */
export const mongoStateStore = (
	modelOf: () => MongoStateModel,
	options: StateStoreOptions = {}
): StateStore => {
	const now = options.now ?? currentDate

	/** The `value` of the row `key`, undefined when there is no such row. */
	const valueAt = async (key: string): Promise<unknown> => {
		const doc = await modelOf().findOne({ _id: key }, null, { lean: true })
		return isRecord(doc) ? doc.value : undefined
	}

	/** Sets the `value` of the row `key`, creating it as `kind` of `scope` when missing. */
	const writeValue = (
		key: string,
		value: object,
		{ kind, scope }: { kind: string; scope: string }
	): Promise<unknown> =>
		upsertRetrying(() =>
			modelOf().findOneAndUpdate(
				{ _id: key },
				{ $set: { value }, $setOnInsert: { kind, scope } },
				{ ...AFTER, upsert: true }
			)
		)

	const prunedAt = async (scope: string): Promise<Date | null> =>
		atOf(await valueAt(prunedKey(scope)))

	return {
		async salt(day) {
			const key = saltKey(day)
			const stored = await upsertRetrying(() =>
				modelOf().findOneAndUpdate(
					{ _id: key },
					{
						$setOnInsert: {
							kind: 'salt',
							scope: '',
							day,
							value: randomBytes(32).toString('base64url'),
							expiresAt: saltExpiresAt(day),
						},
					},
					{ ...AFTER, upsert: true }
				)
			)
			const salt = isRecord(stored) ? stored.value : undefined
			if (typeof salt !== 'string' || salt === '') {
				throw new Error(`analytics: the salt "${key}" could not be read back`)
			}
			return salt
		},

		async markers(scope, from, to) {
			if (to < from) {
				return []
			}
			const docs = await modelOf().find(
				{ kind: 'day', scope, day: { $gte: from, $lte: to } },
				null,
				{ lean: true, sort: { day: 1 } }
			)
			return markersOf(docs).sort((a, b) => a.day - b.day)
		},

		async markersIn(scopes, from, to) {
			if (to < from) {
				return []
			}
			const found: DayMarker[] = []
			for (const chunk of chunksOf([...new Set(scopes)], CHUNK)) {
				const docs = await modelOf().find(
					{ kind: 'day', scope: { $in: chunk }, day: { $gte: from, $lte: to } },
					null,
					{ lean: true }
				)
				found.push(...markersOf(docs))
			}
			return found.sort((a, b) => compareCodePoints(a.scope, b.scope) || a.day - b.day)
		},

		async ensureMarkers(markers) {
			const unique = new Map(markers.map((marker) => [dayKey(marker.scope, marker.day), marker]))
			for (const chunk of chunksOf([...unique], CHUNK)) {
				const operations = chunk.map(([key, marker]) => ({
					updateOne: {
						filter: { _id: key },
						update: {
							$setOnInsert: {
								kind: 'day',
								scope: marker.scope,
								day: marker.day,
								tz: marker.tz,
								status: 'open',
								finalAfter: dayFinalAfter(marker.day, marker.tz),
							},
						},
						upsert: true,
					},
				}))
				try {
					await modelOf().bulkWrite(operations, { ordered: false })
				} catch (err) {
					// Another process inserted some of these markers between the match and the insert.
					if (!isUniqueViolation(err)) {
						throw err
					}
				}
			}
		},

		async claim(key, owner, ttlMs) {
			const kind = stateKindOf(key)
			const at = now()
			const lease = { $set: { leaseOwner: owner, leaseUntil: leaseUntilFrom(at, ttlMs) } }
			if (kind === 'day') {
				const won = await modelOf().findOneAndUpdate(
					{ _id: key, ...leaseFree(at, owner) },
					lease,
					AFTER
				)
				return isRecord(won)
			}
			if (kind !== 'lease') {
				throw new Error(`analytics: "${key}" is neither a lease nor a day marker`)
			}
			try {
				// A held lease fails the match, and the upsert then collides with the existing `_id`.
				const won = await modelOf().findOneAndUpdate(
					{ _id: key, ...leaseFree(at, owner) },
					{ ...lease, $setOnInsert: { kind, scope: '' } },
					{ ...AFTER, upsert: true }
				)
				return isRecord(won)
			} catch (err) {
				if (isUniqueViolation(err)) {
					return false
				}
				throw err
			}
		},

		async renew(key, owner, ttlMs) {
			const renewed = await modelOf().findOneAndUpdate(
				{ _id: key, leaseOwner: owner },
				{ $set: { leaseUntil: leaseUntilFrom(now(), ttlMs) } },
				AFTER
			)
			return isRecord(renewed)
		},

		async held(key) {
			const doc = await modelOf().findOne({ _id: key }, { leaseUntil: 1 }, { lean: true })
			const until = isRecord(doc) ? dateOf(doc.leaseUntil) : null
			return until !== null && until.getTime() >= now().getTime()
		},

		async release(key, owner) {
			const released = await modelOf().findOneAndUpdate(
				{ _id: key, leaseOwner: owner },
				{ $set: { leaseOwner: null, leaseUntil: null } },
				AFTER
			)
			return isRecord(released)
		},

		async complete(marker, owner, guard) {
			const completed = await modelOf().findOneAndUpdate(
				{
					_id: dayKey(marker.scope, marker.day),
					leaseOwner: owner,
					...(guard?.clean === true ? { status: { $ne: 'dirty' } } : {}),
				},
				{
					$set: {
						status: marker.status,
						tz: marker.tz,
						value: markerValue(marker),
						version: marker.version,
						gen: marker.gen,
						hits: marker.hits,
						finalAfter: marker.finalAfter,
						aggregatedAt: marker.aggregatedAt,
						leaseOwner: null,
						leaseUntil: null,
					},
				},
				AFTER
			)
			return isRecord(completed)
		},

		async attempt(marker, owner) {
			const written = await modelOf().findOneAndUpdate(
				{ _id: dayKey(marker.scope, marker.day), leaseOwner: owner },
				{ $set: { status: marker.status, value: markerValue(marker) } },
				AFTER
			)
			return isRecord(written)
		},

		async markDirty(scope, days) {
			for (const chunk of chunksOf([...new Set(days)], CHUNK)) {
				await modelOf().updateMany(
					{ _id: { $in: chunk.map((day) => dayKey(scope, day)) }, kind: 'day' },
					{
						$set: { status: 'dirty', leaseOwner: null, leaseUntil: null },
						$unset: { 'value.failures': '' },
					}
				)
			}
		},

		async pending(at, limit, after) {
			checkStateLimit('pending', limit)
			const docs = await modelOf().find(
				{
					kind: 'day',
					$and: [
						{ $or: [{ leaseUntil: null }, { leaseUntil: { $lt: at } }] },
						{
							$or: [
								{ status: 'dirty' },
								{ status: { $in: ['open', 'partial'] }, finalAfter: { $lte: openDueBy(at) } },
								{ status: 'provisional', finalAfter: { $lte: at } },
							],
						},
						...(after === undefined
							? []
							: [
									{
										$or: [
											{ day: { $gt: after.day } },
											{ day: after.day, scope: { $gt: after.scope } },
										],
									},
								]),
					],
				},
				null,
				{ lean: true, sort: { day: 1, scope: 1 }, limit }
			)
			return markersOf(docs)
		},

		async dropMarkers(scope, beforeDay) {
			return deletedOf(await modelOf().deleteMany({ kind: 'day', scope, day: { $lt: beforeDay } }))
		},

		prunedBefore: prunedAt,

		async prunedBeforeIn(scopes) {
			const found = new Map<string, Date>()
			for (const chunk of chunksOf([...new Set(scopes)], CHUNK)) {
				const docs = await modelOf().find(
					{ _id: { $in: chunk.map((each) => prunedKey(each)) } },
					{ scope: 1, value: 1 },
					{ lean: true }
				)
				for (const doc of foundDocuments(docs)) {
					const at = atOf(doc.value)
					if (typeof doc.scope === 'string' && at !== null) {
						found.set(doc.scope, at)
					}
				}
			}
			return found
		},

		async recordPruned(scope, before) {
			const recorded = await prunedAt(scope)
			if (recorded !== null && recorded >= before) {
				return
			}
			await writeValue(prunedKey(scope), { at: before.toISOString() }, { kind: 'pruned', scope })
		},

		async lastZone(scope) {
			const doc = await modelOf().findOne(
				{ kind: 'day', scope, aggregatedAt: { $ne: null } },
				{ tz: 1 },
				{ lean: true, sort: { day: -1 } }
			)
			return isRecord(doc) && typeof doc.tz === 'string' ? doc.tz : null
		},

		async scopes() {
			return distinctStrings(await modelOf().distinct('scope', { kind: 'day' })).sort(
				compareCodePoints
			)
		},

		async noteDrop(note) {
			await upsertRetrying(() =>
				modelOf().findOneAndUpdate(
					{ _id: dropKey(note) },
					{ $setOnInsert: { kind: 'drop', scope: note.scope, day: note.day, gen: note.gen } },
					{ ...AFTER, upsert: true }
				)
			)
		},

		async drops(limit) {
			checkStateLimit('drops', limit)
			const docs = await modelOf().find({ kind: 'drop' }, null, {
				lean: true,
				sort: { day: 1, _id: 1 },
				limit,
			})
			return foundDocuments(docs).flatMap((doc): DropNote[] => {
				const note = dropOf(doc)
				return note ? [note] : []
			})
		},

		async clearDrop(note) {
			await modelOf().deleteOne({ _id: dropKey(note) })
		},

		async sweep(at) {
			return deletedOf(await modelOf().deleteMany({ kind: 'salt', expiresAt: { $lte: at } }))
		},

		async beat(task) {
			const key = heartbeatKey(task)
			await upsertRetrying(() =>
				modelOf().findOneAndUpdate(
					{ _id: key },
					{
						$set: { value: { at: now().toISOString() } },
						$setOnInsert: { kind: 'heartbeat', scope: '' },
					},
					{ ...AFTER, upsert: true }
				)
			)
		},

		async lastBeat(task) {
			return atOf(await valueAt(heartbeatKey(task)))
		},

		async cursor(task) {
			return cursorOf(await valueAt(cursorKey(task)))
		},

		async setCursor(task, cursor) {
			await writeValue(cursorKey(task), { cursor }, { kind: 'cursor', scope: '' })
		},

		async configToken(scope) {
			return tokenOf(await valueAt(epochStateKey(scope)))
		},

		async setConfigToken(scope, token) {
			await writeValue(epochStateKey(scope), { token }, { kind: 'epoch', scope })
		},
	}
}
