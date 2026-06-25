import type { PayloadHandler } from 'payload'
import { createSipgateContactsStore } from './sipgateContactsStore'

export const sipgateContactsHandler: PayloadHandler = async (req) => {
	const contactsStore = createSipgateContactsStore(req.payload)

	const contacts = await contactsStore.get()
	return Response.json(contacts)
}
