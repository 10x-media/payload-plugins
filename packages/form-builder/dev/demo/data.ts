import { resolveConsentStatements, resolveEffectivePollOptions } from '@10x-media/form-builder/rsc'
import { createPayloadRequest, type Payload } from 'payload'

/**
 * The website demo pages' data, shared by the Next pages (`dev/app/(frontend)`) and the TanStack
 * routes (`dev-tanstack/src/app`). Forms are read as an anonymous visitor (no `overrideAccess`), so
 * the signed-in-only `actions` never reach the page.
 */
const findForm = async (payload: Payload, title: string) => {
	const { docs } = await payload.find({
		collection: 'forms',
		where: { title: { equals: title } },
		limit: 1,
		depth: 0,
	})
	return docs[0] ?? null
}

export const loadFormDemo = async (payload: Payload) => {
	const form = await findForm(payload, 'Demo Contact')
	if (!form) {
		return null
	}
	// The form stores only a source id per consent field; the statement the visitor reads is
	// resolved here, for this request's locale, from whatever the source says right now.
	// `createPayloadRequest` is what gives the host resolver a real `req` outside a route handler.
	const req = await createPayloadRequest({ payload })
	const consentStatements = await resolveConsentStatements({ payload, req, form })
	return { form, consentStatements }
}

export const loadPollDemo = async (payload: Payload) => {
	const form = await findForm(payload, 'Favorite framework')
	return form ? { form } : null
}

export const loadAthletesDemo = async (payload: Payload) => {
	const form = await findForm(payload, 'Who will win?')
	if (!form) {
		return null
	}
	// The athleteVote field stores only the ids of the voteable athletes; the choices a visitor sees
	// are resolved here from the field's own `resolveOptions` (the four athletes the author picked)
	// and injected onto the field by `toFormDocument({ pollOptions })` in the client wrapper.
	const req = await createPayloadRequest({ payload })
	const pollOptions = await resolveEffectivePollOptions({ payload, req, form })
	return { form, pollOptions }
}
