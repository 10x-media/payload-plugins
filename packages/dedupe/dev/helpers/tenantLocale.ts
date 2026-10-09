import { tenantOf } from '@10x-media/dedupe'
import type { WriteLocale } from '@10x-media/dedupe/types'
import type { CollectionSlug } from 'payload'

/**
 * Dev stand only: `writeLocale` for a tenant-scoped collection, the language of the survivor's
 * office. A document of no office answers nothing, and the merge picks a locale itself.
 */
export const tenantLocale =
	(collection: CollectionSlug): WriteLocale =>
	async ({ req, survivor }) => {
		const tenant = tenantOf(req.payload, collection, survivor)
		if (!tenant) return null
		const office = await req.payload.findByID({
			collection: 'tenants',
			id: tenant,
			depth: 0,
			disableErrors: true,
			req,
		})
		return (office as { locale?: string } | null)?.locale ?? null
	}
