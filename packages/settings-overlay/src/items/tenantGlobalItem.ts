import type { CollectionSlug, PayloadRequest } from 'payload'
import { parseCookies } from 'payload'
import { hasAutosaveEnabled } from 'payload/shared'

import type { CollectionItem, ResolveDocID } from '../types'

/** The cookie `@payloadcms/plugin-multi-tenant` writes when the tenant selector changes. */
const TENANT_COOKIE = 'payload-tenant'

/**
 * The selected tenant, coerced to the tenants collection's id type the way the multi-tenant
 * plugin's own `getCollectionIDType` does: a collection declaring its own `id` field is text,
 * anything else follows the adapter's default.
 */
const tenantFromRequest = (req: PayloadRequest, tenantsSlug: string): null | number | string => {
	const raw = parseCookies(req.headers).get(TENANT_COOKIE) || null
	if (!raw) {
		return null
	}
	const declaresOwnID = Boolean(
		req.payload.collections[tenantsSlug as CollectionSlug]?.config.fields.some(
			(field) => 'name' in field && field.name === 'id'
		)
	)
	const idType = declaresOwnID ? 'text' : req.payload.db.defaultIDType
	return idType === 'number' && raw.trim() !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw
}

export type TenantGlobalItemOptions = {
	/** Field on the collection holding the tenant relationship. @default 'tenant' */
	tenantFieldName?: string
	/** The tenants collection, used only to decide whether ids are numbers. @default 'tenants' */
	tenantsCollectionSlug?: string
} & Partial<Omit<CollectionItem, 'resolveDocID' | 'type'>> &
	Pick<CollectionItem, 'slug'>

/**
 * A collection that `@payloadcms/plugin-multi-tenant` treats as a global: one document per
 * tenant, addressed as if it were a singleton.
 *
 * The multi-tenant plugin solves this with `GlobalViewRedirect`, registered as a global
 * `admin.components.actions`. Actions are collected in `views/Root/getRouteData` and rendered by
 * the page template, so `render-list` and `render-document` never see them, and the redirect it
 * performs would take the whole window rather than the panel. Resolving on the server before the
 * render is the equivalent that works inside a panel.
 *
 * The id is resolved on every open rather than pinned into the URL, because "the current
 * tenant's document" changes when the tenant does.
 *
 * Requires `@payloadcms/plugin-multi-tenant` in the host, but not as an import: only the cookie
 * name and the tenant field are shared, so the plugin core stays unaware of multi-tenancy.
 */
export const tenantGlobalItem = ({
	tenantFieldName = 'tenant',
	tenantsCollectionSlug = 'tenants',
	...overrides
}: TenantGlobalItemOptions): CollectionItem => {
	const resolveDocID: ResolveDocID = async ({ item, req }) => {
		const tenant = tenantFromRequest(req, tenantsCollectionSlug)
		if (!tenant) {
			return null
		}

		const found = await req.payload.find(
			// `find`, `create` and `collections` are keyed by the specific collection slug, and this
			// resolver is handed one at runtime. In a project with generated types that slug is a
			// union, so `select`, `where` and `data` no longer accept a shape built from a variable.
			// The cast is confined to the call boundary rather than spread through the resolver.
			{
				collection: item.slug,
				depth: 0,
				limit: 1,
				pagination: false,
				select: { id: true },
				where: { [tenantFieldName]: { in: [tenant] } },
			} as Parameters<typeof req.payload.find>[0]
		)

		const existing = found.docs[0]?.id
		if (existing) {
			return String(existing)
		}

		// Autosave collections have no usable create form: Payload's own redirect creates the
		// draft first and opens it, and the panel has to do the same or the reader lands on a
		// form that saves nothing.
		const collectionConfig = req.payload.collections[item.slug as CollectionSlug]?.config
		if (collectionConfig && hasAutosaveEnabled(collectionConfig)) {
			try {
				const created = await req.payload.create({
					collection: item.slug,
					data: { [tenantFieldName]: tenant },
					depth: 0,
					draft: true,
					select: { id: true },
				} as Parameters<typeof req.payload.create>[0])
				return String(created.id)
			} catch (error) {
				req.payload.logger.error(
					error,
					`[settings-overlay] could not create the autosave tenant document for "${item.slug}"`
				)
				return null
			}
		}

		return 'create'
	}

	return {
		type: 'collection',
		...overrides,
		resolveDocID,
	}
}
