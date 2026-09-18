import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'

/**
 * The KV key a day's visitor salt lives under. Keyed by UTC day so the salt rotates at
 * midnight; payload.kv has no TTL, so the nightly prune task deletes old days by this name.
 */
export const saltKey = (day: Date): string => `analytics:salt:${day.toISOString().slice(0, 10)}`

export async function dailySalt(payload: Payload, now: Date): Promise<string> {
	const key = saltKey(now)
	const existing = await payload.kv.get<{ salt: string }>(key)
	if (existing) {
		return existing.salt
	}
	const salt = randomBytes(16).toString('hex')
	await payload.kv.set(key, { salt })
	return salt
}
