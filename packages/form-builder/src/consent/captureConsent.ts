import type { Payload, PayloadRequest } from 'payload'
import type { FormFieldInstance } from '../submissions/types'
import type { ConsentSourceRegistry } from './registry'
import { resolveConsentLinks } from './resolveConsentLinks'

export type ConsentProof = {
	agreed: boolean
	ref?: string
	versionRef?: string
	at: string
}

/**
 * Build the authoritative consent proof at submit time: re-resolve the source server-side
 * (ignores any client ref), capturing a reference url -- never the policy text.
 * `now` is injected by the caller (`new Date().toISOString()`) for testability.
 */
export const captureConsent = async (args: {
	field: FormFieldInstance
	agreed: boolean
	registry: ConsentSourceRegistry
	payload: Payload
	req?: PayloadRequest
	locale: string
	now: string
}): Promise<ConsentProof> => {
	const resolved = await resolveConsentLinks(args.field, {
		registry: args.registry,
		payload: args.payload,
		req: args.req,
		locale: args.locale,
	})
	const ref = resolved.links[0]?.url || undefined
	return {
		agreed: args.agreed,
		...(ref ? { ref } : {}),
		...(resolved.versionRef ? { versionRef: resolved.versionRef } : {}),
		at: args.now,
	}
}
