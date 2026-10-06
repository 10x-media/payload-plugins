import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'

const DAY_MS = 86_400_000

/**
 * The KV key a day's visitor salt lives under. Keyed by UTC day so the salt rotates at
 * midnight; payload.kv has no TTL, so old days are deleted by this name.
 */
export const saltKey = (day: Date): string => `analytics:salt:${day.toISOString().slice(0, 10)}`

/**
 * An event arriving just before midnight is still hashed with yesterday's salt, so the sweep
 * starts two days back. A week is what one ingest can reach without a listing; the nightly
 * task covers a wider window when an install runs it.
 */
const SWEEP_FIRST_DAY = 2
const SWEEP_LAST_DAY = 8

/**
 * Deletes the salts a new day has made unreadable, without waiting on them: the salts must not
 * accumulate forever on an install that runs no jobs, and no visitor hash depends on this
 * finishing. Keys go by computed name, so a day already gone is a no-op on every kv adapter.
 */
const sweepOldSalts = (payload: Payload, now: Date): void => {
	for (let day = SWEEP_FIRST_DAY; day <= SWEEP_LAST_DAY; day++) {
		const stale = saltKey(new Date(now.getTime() - day * DAY_MS))
		// The call itself is inside the thenable, so a kv adapter that throws synchronously
		// fails the sweep rather than the ingest that triggered it.
		void Promise.resolve()
			.then(() => payload.kv.delete(stale))
			.catch(() => undefined)
	}
}

export async function dailySalt(payload: Payload, now: Date): Promise<string> {
	const key = saltKey(now)
	const existing = await payload.kv.get<{ salt: string }>(key)
	if (existing) {
		return existing.salt
	}
	const salt = randomBytes(16).toString('hex')
	await payload.kv.set(key, { salt })
	sweepOldSalts(payload, now)
	return salt
}
