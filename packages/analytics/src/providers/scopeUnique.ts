import type { CollectionSlug, PayloadRequest, Where } from 'payload'
import { memberScopeOf, type ProviderAccessArgs } from './access'
import { providerScopeWhere } from './resolver'

/** A write to one of the plugin's scoped collections, as its `beforeValidate` hook sees it. */
export interface ScopedWrite {
	data?: Record<string, unknown>
	originalDoc?: Record<string, unknown>
	req: PayloadRequest
}

const asScope = (value: unknown): string | null =>
	value === null || value === undefined || value === '' ? null : String(value)

/**
 * The scope the stamp will land the write in. Only a platform admin's declared scope is trusted:
 * anyone else's would turn "already taken" into an oracle for what another tenant owns.
 */
const writeScope = async (args: ProviderAccessArgs, write: ScopedWrite): Promise<string | null> => {
	const { data, originalDoc, req } = write
	try {
		if (await args.crossScope({ req })) {
			// No declared scope means an install-wide document, not one in whatever scope the
			// admin's own request happens to resolve to.
			return asScope(data?.[args.scopeField]) ?? asScope(originalDoc?.[args.scopeField])
		}
		return await memberScopeOf(args, req)
	} catch {
		return null
	}
}

/**
 * Whether another document of the collection already matches `match` in the scope the write lands
 * in, or anywhere on an unscoped install. Read past access, so a row the writer cannot see counts.
 */
export const takenInScope = async (
	args: ProviderAccessArgs & { slug: string },
	write: ScopedWrite,
	match: Where
): Promise<boolean> => {
	const where: Where[] = [match]
	if (args.scoped) {
		where.push(providerScopeWhere(args.scopeField, await writeScope(args, write)))
	}
	const id = write.originalDoc?.id
	if (id !== undefined && id !== null) {
		where.push({ id: { not_equals: id } })
	}
	// pagination:false is load-bearing: a paginated read fires its count and its find in
	// parallel on one Mongo session, which the write's open transaction refuses.
	const { docs } = await write.req.payload.find({
		// Only the collection's own hooks call this, so its slug is registered.
		collection: args.slug as CollectionSlug,
		where: { and: where },
		limit: 1,
		pagination: false,
		depth: 0,
		overrideAccess: true,
		req: write.req,
	})
	return docs.length > 0
}
