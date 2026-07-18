import type { CollectionConfig } from 'payload'
import { iconField } from '../../src/exports/icon'
import { lucideAdapter } from '../../src/exports/icon-adapters/lucide'

/** Every library the dev app registers; the fallback when no tenant scopes the selection. */
const ALL_DEV_LIBRARIES = ['lucide', 'radix', 'tabler']

/** Relationship sibling data may arrive as a bare id or a populated `{ id }` doc depending on depth. */
const readTenantId = (value: unknown): number | string | null => {
	if (typeof value === 'string' || typeof value === 'number') {
		return value
	}
	if (value != null && typeof value === 'object' && 'id' in value) {
		const { id } = value as { id: unknown }
		return typeof id === 'string' || typeof id === 'number' ? id : null
	}
	return null
}

export const icons: CollectionConfig = {
	slug: 'icons',
	admin: { useAsTitle: 'title' },
	fields: [
		{
			type: 'row',
			fields: [
				{ name: 'title', type: 'text', required: true, admin: { width: '50%' } },
				{
					name: 'tenant',
					type: 'relationship',
					relationTo: 'tenants',
					admin: {
						description:
							'Pick a tenant to scope the Tenant-scoped field below to its enabled libraries.',
						width: '50%',
					},
				},
			],
		},
		{
			type: 'row',
			fields: [
				iconField({
					name: 'iconMulti',
					label: 'Multi-library',
					overrides: ({ field }) => ({
						...field,
						admin: {
							...field.admin,
							description: 'All registered libraries; the drawer shows a library switcher.',
							width: '50%',
						},
					}),
				}),
				iconField({
					adapters: [lucideAdapter()],
					name: 'iconSingle',
					label: 'Single library',
					overrides: ({ field }) => ({
						...field,
						admin: {
							...field.admin,
							description: 'Only Lucide is offered, so the drawer hides the switcher.',
							width: '50%',
						},
					}),
				}),
			],
		},
		{
			type: 'row',
			fields: [
				iconField({
					name: 'iconWithText',
					showTextInput: true,
					label: 'With manual entry',
					overrides: ({ field }) => ({
						...field,
						admin: {
							...field.admin,
							description:
								'Type or paste a raw library:name (e.g. lucide:star), or pick from the drawer.',
							width: '50%',
						},
					}),
				}),
				iconField({
					name: 'iconRequired',
					required: true,
					label: 'Required',
					overrides: ({ field }) => ({
						...field,
						admin: {
							...field.admin,
							description:
								'Required: a valid library:name must be set before the document can save.',
							width: '50%',
						},
					}),
				}),
			],
		},
		iconField({
			name: 'iconTenantRestricted',
			label: 'Tenant-scoped',
			resolveAvailable: async ({ req, siblingData }) => {
				const tenantId = readTenantId(siblingData?.tenant)
				if (tenantId == null) {
					return ALL_DEV_LIBRARIES
				}
				const tenant = await req.payload.findByID({ collection: 'tenants', id: tenantId })
				const enabled = tenant.enabledLibraries
				return Array.isArray(enabled) ? (enabled as string[]) : []
			},
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					description:
						"resolveAvailable reads the selected tenant's enabledLibraries. Acme enables Lucide and Radix, so its drawer shows a switcher for those two; Globex enables only Tabler, so the switcher is hidden. An icon stored from a library the tenant no longer enables still renders, but is flagged as unavailable with a banner in the drawer.",
				},
			}),
		}),
	],
}
