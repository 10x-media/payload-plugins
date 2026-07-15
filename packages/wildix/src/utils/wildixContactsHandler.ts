import { GetPbxColleaguesCommand } from '@wildix/wms-api-client'
import type { PayloadHandler } from 'payload'
import type { WildixCredentials } from '../types'
import type { WildixAccess } from './access'
import { checkAccess } from './access'
import { resolveWildixClient } from './resolveWildixClient'

type WildixContact = { name: string; phone: string }

type WildixContactsHandlerOptions = {
	credentials: WildixCredentials
	access?: WildixAccess
	wildixUsersSlug?: string
}

const CACHE_KEY = '@10x-media/wildix:contacts'
const CACHE_TTL_MS = 60 * 60 * 1000

/**
 * Returns the company directory (Wildix colleagues) as `{ name, phone }` entries,
 * cached in the KV store for one hour.
 */
export const wildixContactsHandler =
	({ credentials, access, wildixUsersSlug }: WildixContactsHandlerOptions): PayloadHandler =>
	async (req) => {
		const denied = await checkAccess(req, access, 'contacts')
		if (denied) return denied

		const cached = await req.payload.kv.get<{ contacts: WildixContact[]; at: number }>(CACHE_KEY)
		if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
			return Response.json({ contacts: cached.contacts, cached: true }, { status: 200 })
		}

		const resolved = await resolveWildixClient({ req, credentials, wildixUsersSlug })
		if ('error' in resolved) return resolved.error

		try {
			const response = await resolved.client.send(new GetPbxColleaguesCommand({ count: 1000 }))
			const contacts: WildixContact[] = (response.result?.records ?? []).flatMap((c) => {
				const phone = c.extension ?? c.officePhone ?? c.mobilePhone
				if (!phone) return []
				return [{ name: c.name ?? c.extension, phone }]
			})
			await req.payload.kv.set(CACHE_KEY, { contacts, at: Date.now() })
			return Response.json({ contacts, cached: false }, { status: 200 })
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err)
			req.payload.logger.error({ detail }, '[wildix:contacts] failed to fetch colleagues')
			return Response.json({ error: 'Failed to fetch contacts', detail }, { status: 502 })
		}
	}
