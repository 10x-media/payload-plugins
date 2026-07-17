import type { CollectionConfig } from 'payload'
import { iconField } from '../../src/exports/icon'
import { lucideAdapter } from '../../src/exports/icon-adapters/lucide'

export const icons: CollectionConfig = {
	slug: 'icons',
	admin: { useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'tenant', type: 'relationship', relationTo: 'tenants' },
		iconField({ name: 'iconMulti' }),
		iconField({ adapters: [lucideAdapter()], name: 'iconSingle' }),
		iconField({ name: 'iconWithText', showTextInput: true }),
		iconField({ name: 'iconRequired', required: true }),
		iconField({
			name: 'iconTenantRestricted',
			resolveAvailable: async ({ req, siblingData }) => {
				const tenantId = siblingData?.tenant
				if (tenantId == null) {
					return ['lucide', 'radix', 'tabler']
				}
				const tenant = await req.payload.findByID({
					collection: 'tenants',
					id: tenantId as string | number,
				})
				const enabled = tenant.enabledLibraries
				return Array.isArray(enabled) ? (enabled as string[]) : []
			},
		}),
	],
}
