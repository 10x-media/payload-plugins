import type { PayloadHandler } from 'payload'
import type { WildixCredentials } from '../types'
import type { WildixAccess } from './access'
import { checkAccess } from './access'
import { resolveWildixToken } from './resolveWildixClient'
import { fetchPbxContacts, type NormalizedContact, normalizePbxContacts } from './wildixPbxRest'

type WildixContactsHandlerOptions = {
	credentials: WildixCredentials
	access?: WildixAccess
	wildixUsersSlug?: string
}

const CACHE_KEY = '@10x-media/wildix:contacts:v2'
const CACHE_TTL_MS = 60 * 60 * 1000

/**
 * Returns the PBX phonebook (`GET /api/v1/Contacts/`) as `{ name, phone }`
 * entries, one per non-empty number field, cached in the KV store for one hour.
 * Uses raw REST because `@wildix/wms-api-client` has no Contacts command.
 */
export const wildixContactsHandler =
	({ credentials, access, wildixUsersSlug }: WildixContactsHandlerOptions): PayloadHandler =>
	async (req) => {
		const denied = await checkAccess(req, access, 'contacts')
		if (denied) return denied

		const cached = await req.payload.kv.get<{ contacts: NormalizedContact[]; at: number }>(
			CACHE_KEY
		)
		if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
			return Response.json({ contacts: cached.contacts, cached: true }, { status: 200 })
		}

		const resolved = await resolveWildixToken({ req, credentials, wildixUsersSlug })
		if ('error' in resolved) return resolved.error

		try {
			const records = await fetchPbxContacts({ credentials, token: resolved.token })
			const contacts = normalizePbxContacts(records)
			await req.payload.kv.set(CACHE_KEY, { contacts, at: Date.now() })
			return Response.json({ contacts, cached: false }, { status: 200 })
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err)
			req.payload.logger.error({ detail }, '[wildix:contacts] failed to fetch phonebook')
			return Response.json({ error: 'Failed to fetch contacts', detail }, { status: 502 })
		}
	}
