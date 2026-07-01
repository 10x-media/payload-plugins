import type { Payload } from 'payload'
import type { SipgateContact } from '../types'
import type { SipgateRestFetch } from './sipgate.rest'
import { getContacts } from './sipgate.rest'

const BASE_KEY = '@10x-media/sipgate:contacts'
const CACHE_DURATION = 1000 * 60 * 60

type StoredContacts = {
	contacts: SipgateContact
	lastUpdated: number
}

export const createSipgateContactsStore = (
	payload: Payload,
	rest: SipgateRestFetch,
	/** When provided, the cache is scoped to this user so OAuth2 users don't share contact data. */
	userId?: string
) => {
	const key = userId ? `${BASE_KEY}:${userId}` : BASE_KEY
	return {
		get: async () => {
			const contactsCached = JSON.parse((await payload.kv.get(key)) ?? '{}') as StoredContacts
			if (contactsCached.lastUpdated && Date.now() - contactsCached.lastUpdated < CACHE_DURATION) {
				return contactsCached.contacts
			}
			const contacts = await getContacts(rest)
			await payload.kv.set(key, JSON.stringify({ contacts, lastUpdated: Date.now() }))
			return contacts
		},
	}
}
