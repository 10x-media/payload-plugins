import { randomBytes } from 'node:crypto'
import { currentDate } from '../../../core/clock'
import { compareCodePoints } from '../rawRead'
import {
	checkStateLimit,
	cursorKey,
	dayFinalAfter,
	dayKey,
	daysFrom,
	dropKey,
	epochStateKey,
	heartbeatKey,
	leaseUntilFrom,
	openDueBy,
	saltExpiresAt,
	saltKey,
	stateKindOf,
} from '../state'
import type { DayMarker, DropNote, StateStore, StateStoreOptions } from '../types'

interface Lease {
	owner: string | null
	until: Date | null
}

/** A marker with its failures forgotten, as a completion or a dirty mark writes it. */
const withoutFailures = ({ failures, ...marker }: DayMarker): DayMarker => marker

const isFree = (lease: Lease, owner: string, now: Date): boolean =>
	lease.until === null || lease.until < now || lease.owner === owner

const leaseOf = (marker: DayMarker): Lease => ({
	owner: marker.leaseOwner,
	until: marker.leaseUntil,
})

/**
 * The state store in plain memory, for the memory event store and the tests that need one: the
 * same leases, fences and day markers as the database stores, held by one process.
 */
export const memoryStateStore = (options: StateStoreOptions = {}): StateStore => {
	const now = options.now ?? currentDate
	const markers = new Map<string, DayMarker>()
	const leases = new Map<string, Lease>()
	const salts = new Map<string, { value: string; expiresAt: Date }>()
	const beats = new Map<string, Date>()
	const tokens = new Map<string, string>()
	const cursors = new Map<string, string>()
	const pruned = new Map<string, Date>()
	const notes = new Map<string, DropNote>()

	return {
		async salt(day) {
			const key = saltKey(day)
			const stored = salts.get(key) ?? {
				value: randomBytes(32).toString('base64url'),
				expiresAt: saltExpiresAt(day),
			}
			salts.set(key, stored)
			return stored.value
		},

		async markers(scope, from, to) {
			return daysFrom(from, to).flatMap((day) => {
				const marker = markers.get(dayKey(scope, day))
				return marker ? [{ ...marker }] : []
			})
		},

		async markersIn(scopes, from, to) {
			const wanted = new Set(scopes)
			return [...markers.values()]
				.filter((marker) => wanted.has(marker.scope) && marker.day >= from && marker.day <= to)
				.sort((a, b) => compareCodePoints(a.scope, b.scope) || a.day - b.day)
				.map((marker) => ({ ...marker }))
		},

		async ensureMarkers(list) {
			for (const marker of list) {
				const key = dayKey(marker.scope, marker.day)
				if (!markers.has(key)) {
					markers.set(key, {
						scope: marker.scope,
						day: marker.day,
						tz: marker.tz,
						start: null,
						status: 'open',
						version: null,
						gen: null,
						hits: null,
						leaseOwner: null,
						leaseUntil: null,
						finalAfter: dayFinalAfter(marker.day, marker.tz),
						aggregatedAt: null,
					})
				}
			}
		},

		async claim(key, owner, ttlMs) {
			const at = now()
			const until = leaseUntilFrom(at, ttlMs)
			const kind = stateKindOf(key)
			if (kind === 'day') {
				const marker = markers.get(key)
				if (!marker || !isFree(leaseOf(marker), owner, at)) {
					return false
				}
				markers.set(key, { ...marker, leaseOwner: owner, leaseUntil: until })
				return true
			}
			if (kind !== 'lease') {
				throw new Error(`analytics: "${key}" is neither a lease nor a day marker`)
			}
			const lease = leases.get(key) ?? { owner: null, until: null }
			if (!isFree(lease, owner, at)) {
				return false
			}
			leases.set(key, { owner, until })
			return true
		},

		async renew(key, owner, ttlMs) {
			const until = leaseUntilFrom(now(), ttlMs)
			const marker = markers.get(key)
			if (marker) {
				if (marker.leaseOwner !== owner) {
					return false
				}
				markers.set(key, { ...marker, leaseUntil: until })
				return true
			}
			const lease = leases.get(key)
			if (!lease || lease.owner !== owner) {
				return false
			}
			leases.set(key, { owner, until })
			return true
		},

		async held(key) {
			const until = leases.get(key)?.until
			return until !== null && until !== undefined && until.getTime() >= now().getTime()
		},

		async release(key, owner) {
			const marker = markers.get(key)
			if (marker) {
				if (marker.leaseOwner !== owner) {
					return false
				}
				markers.set(key, { ...marker, leaseOwner: null, leaseUntil: null })
				return true
			}
			const lease = leases.get(key)
			if (!lease || lease.owner !== owner) {
				return false
			}
			leases.set(key, { owner: null, until: null })
			return true
		},

		async complete(marker, owner, guard) {
			const key = dayKey(marker.scope, marker.day)
			const current = markers.get(key)
			if (
				!current ||
				current.leaseOwner !== owner ||
				(guard?.clean === true && current.status === 'dirty')
			) {
				return false
			}
			markers.set(key, {
				...withoutFailures(current),
				...marker,
				leaseOwner: null,
				leaseUntil: null,
			})
			return true
		},

		async attempt(marker, owner) {
			const key = dayKey(marker.scope, marker.day)
			const current = markers.get(key)
			if (!current || current.leaseOwner !== owner) {
				return false
			}
			markers.set(key, {
				...withoutFailures(current),
				status: marker.status,
				...((marker.failures ?? 0) > 0 ? { failures: marker.failures } : {}),
			})
			return true
		},

		async markDirty(scope, days) {
			for (const day of days) {
				const key = dayKey(scope, day)
				const marker = markers.get(key)
				if (marker) {
					markers.set(key, {
						...withoutFailures(marker),
						status: 'dirty',
						leaseOwner: null,
						leaseUntil: null,
					})
				}
			}
		},

		async pending(at, limit, after) {
			checkStateLimit('pending', limit)
			const dueBy = openDueBy(at)
			return [...markers.values()]
				.filter((marker) => {
					if (marker.leaseUntil !== null && marker.leaseUntil >= at) {
						return false
					}
					if (
						after !== undefined &&
						(marker.day < after.day ||
							(marker.day === after.day && compareCodePoints(marker.scope, after.scope) <= 0))
					) {
						return false
					}
					const settled = marker.finalAfter
					return (
						marker.status === 'dirty' ||
						((marker.status === 'open' || marker.status === 'partial') &&
							settled !== null &&
							settled <= dueBy) ||
						(marker.status === 'provisional' && settled !== null && settled <= at)
					)
				})
				.sort((a, b) => a.day - b.day || compareCodePoints(a.scope, b.scope))
				.slice(0, limit)
				.map((marker) => ({ ...marker }))
		},

		async dropMarkers(scope, beforeDay) {
			let dropped = 0
			for (const [key, marker] of markers) {
				if (marker.scope === scope && marker.day < beforeDay) {
					markers.delete(key)
					dropped++
				}
			}
			return dropped
		},

		async prunedBefore(scope) {
			const at = pruned.get(scope)
			return at ? new Date(at.getTime()) : null
		},

		async prunedBeforeIn(scopes) {
			const found = new Map<string, Date>()
			for (const scope of scopes) {
				const at = pruned.get(scope)
				if (at) {
					found.set(scope, new Date(at.getTime()))
				}
			}
			return found
		},

		async recordPruned(scope, before) {
			const recorded = pruned.get(scope)
			if (!recorded || recorded < before) {
				pruned.set(scope, new Date(before.getTime()))
			}
		},

		async lastZone(scope) {
			let newest: DayMarker | undefined
			for (const marker of markers.values()) {
				if (
					marker.scope === scope &&
					marker.aggregatedAt !== null &&
					(!newest || marker.day > newest.day)
				) {
					newest = marker
				}
			}
			return newest?.tz ?? null
		},

		async scopes() {
			return [...new Set([...markers.values()].map((marker) => marker.scope))].sort(
				compareCodePoints
			)
		},

		async noteDrop(note) {
			notes.set(dropKey(note), { ...note })
		},

		async drops(limit) {
			checkStateLimit('drops', limit)
			return [...notes.values()].slice(0, limit).map((note) => ({ ...note }))
		},

		async clearDrop(note) {
			notes.delete(dropKey(note))
		},

		async sweep(at) {
			let deleted = 0
			for (const [key, salt] of salts) {
				if (salt.expiresAt <= at) {
					salts.delete(key)
					deleted++
				}
			}
			return deleted
		},

		async beat(task) {
			beats.set(heartbeatKey(task), now())
		},

		async lastBeat(task) {
			const at = beats.get(heartbeatKey(task))
			return at ? new Date(at.getTime()) : null
		},

		async cursor(task) {
			return cursors.get(cursorKey(task)) ?? null
		},

		async setCursor(task, cursor) {
			if (cursor === null) {
				cursors.delete(cursorKey(task))
			} else {
				cursors.set(cursorKey(task), cursor)
			}
		},

		async configToken(scope) {
			return tokens.get(epochStateKey(scope)) ?? null
		},

		async setConfigToken(scope, token) {
			tokens.set(epochStateKey(scope), token)
		},
	}
}
