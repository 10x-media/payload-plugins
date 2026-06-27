import type { Payload } from 'payload'
import type { SipgateContact } from '../types'
import type { SipgateRestFetch } from './sipgate.rest'
import { getContacts } from './sipgate.rest'

const KEY = '@10x-media/sipgate:contacts'
const CACHE_DURATION = 1000 * 60 * 60

type StoredContacts = {
	contacts: SipgateContact
	lastUpdated: number
}

export const createSipgateContactsStore = (payload: Payload, rest: SipgateRestFetch) => {
	return {
		get: async () => {
			const contactsCached = JSON.parse((await payload.kv.get(KEY)) ?? '{}') as StoredContacts
			if (contactsCached.lastUpdated && Date.now() - contactsCached.lastUpdated < CACHE_DURATION) {
				return contactsCached.contacts
			}
			const contacts = await getContacts(rest)
			await payload.kv.set(KEY, JSON.stringify({ contacts, lastUpdated: Date.now() }))
			return contacts
		},
	}
}
