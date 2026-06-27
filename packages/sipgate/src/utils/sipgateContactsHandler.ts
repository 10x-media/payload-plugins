import type { PayloadHandler } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from './access'
import { checkAccess } from './access'
import { buildSipgateRest } from './sipgate.rest'
import { createSipgateContactsStore } from './sipgateContactsStore'

export const sipgateContactsHandler =
	(credentials: SipgateCredentials, access?: SipgateAccess): PayloadHandler =>
	async (req) => {
		const denied = await checkAccess(req, access, 'contacts')
		if (denied) return denied

		const rest = buildSipgateRest(credentials)
		const contactsStore = createSipgateContactsStore(req.payload, rest)
		const contacts = await contactsStore.get()
		return Response.json(contacts)
	}
