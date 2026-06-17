import type { Payload, PayloadRequest } from 'payload'
import type { FormFieldInstance } from '../submissions/types'
import type { ConsentResolved } from './defineConsentSource'
import type { ConsentSourceRegistry } from './registry'

const EMPTY: ConsentResolved = { links: [] }

/**
 * Resolve a consent field's policy links via its configured source (for display).
 * Unknown/missing source returns empty links. Never throws.
 */
export const resolveConsentLinks = async (
	field: FormFieldInstance,
	ctx: {
		registry: ConsentSourceRegistry
		payload: Payload
		req?: PayloadRequest
		locale: string
	}
): Promise<ConsentResolved> => {
	const sourceType = typeof field.source === 'string' ? field.source : 'static'
	const source = ctx.registry.get(sourceType)
	if (!source) {
		return EMPTY
	}
	// The source params live in the field's `sourceConfig` group (kept off the top level so they cannot collide with the shared field config).
	const sourceConfig =
		field.sourceConfig && typeof field.sourceConfig === 'object'
			? (field.sourceConfig as Record<string, unknown>)
			: {}
	try {
		return await source.resolve({
			config: sourceConfig,
			payload: ctx.payload,
			req: ctx.req,
			locale: ctx.locale,
		})
	} catch {
		return EMPTY
	}
}
