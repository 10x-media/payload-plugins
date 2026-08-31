import type { CollectionConfig, CollectionSlug, Field, Payload } from 'payload'

const TENANTS_SLUG = 'tenants'

const walkFields = (fields: Field[] | undefined, tenantsSlug: string): boolean => {
	if (!fields) return false
	for (const field of fields) {
		if (field.type === 'relationship' && 'relationTo' in field) {
			const rel = field.relationTo
			if (
				rel === tenantsSlug ||
				(Array.isArray(rel) && rel.includes(tenantsSlug as CollectionSlug))
			) {
				return true
			}
		}
		if ('fields' in field && Array.isArray(field.fields) && walkFields(field.fields, tenantsSlug)) {
			return true
		}
		if ('tabs' in field && Array.isArray(field.tabs)) {
			for (const tab of field.tabs) {
				if ('fields' in tab && walkFields(tab.fields, tenantsSlug)) return true
			}
		}
		if ('blocks' in field && Array.isArray(field.blocks)) {
			for (const block of field.blocks) {
				if ('fields' in block && walkFields(block.fields, tenantsSlug)) return true
			}
		}
	}
	return false
}

export const collectionHasTenantRelationship = (
	collection: CollectionConfig,
	tenantsSlug = TENANTS_SLUG
): boolean => walkFields(collection.fields, tenantsSlug)

/**
 * Warn when opted-in collections look tenant-scoped but `scope` is off.
 * Runs at onInit so it still sees fields added by plugins registered after us.
 */
export const warnMissingScope = (args: {
	payload: Payload
	sourceSlugs: string[]
	scopeEnabled: boolean
	tenantsSlug?: string
}): void => {
	if (args.scopeEnabled) return
	const tenantsSlug = args.tenantsSlug ?? TENANTS_SLUG
	for (const slug of args.sourceSlugs) {
		const collection = args.payload.collections?.[slug as CollectionSlug]?.config
		if (!collection) continue
		if (!collectionHasTenantRelationship(collection, tenantsSlug)) continue
		args.payload.logger.warn(
			`@10x-media/sse: collection "${slug}" has a tenant relationship but \`scope\` is off. Collection-wide topics will 403 under Where access and will not isolate tenants. Pass \`scope: true\` or a custom scope resolver.`
		)
	}
}
