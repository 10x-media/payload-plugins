import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'

// Salt is keyed by UTC day so it rotates at midnight; payload.kv has no native TTL,
// hence the date-keyed approach (old salts are pruned in a later plan).
export async function dailySalt(payload: Payload, now: Date): Promise<string> {
	const day = now.toISOString().slice(0, 10)
	const key = `analytics:salt:${day}`
	const existing = await payload.kv.get<{ salt: string }>(key)
	if (existing) {
		return existing.salt
	}
	const salt = randomBytes(16).toString('hex')
	await payload.kv.set(key, { salt })
	return salt
}
