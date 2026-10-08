import type { CollectionConfig } from 'payload'

/** A people-like collection with the field shapes the merge has to handle. */
export const customers: CollectionConfig = {
	slug: 'customers',
	trash: true,
	admin: {
		useAsTitle: 'name',
		defaultColumns: ['name', 'tenant', 'email', 'phone', 'birthDate'],
		// Dev stand only: open the create form with a look-alike typed in.
		components: {
			beforeListTable: ['/components/NearDuplicate#NearDuplicateListButton'],
			edit: { beforeDocumentControls: ['/components/NearDuplicate#NearDuplicateButton'] },
		},
	},
	fields: [
		{
			name: 'devPrefill',
			type: 'ui',
			admin: {
				disableListColumn: true,
				components: { Field: '/components/NearDuplicate#DevPrefill' },
			},
		},
		{ name: 'name', type: 'text', localized: true },
		{ name: 'email', type: 'email', unique: true },
		{ name: 'customerNumber', type: 'number', unique: true },
		{ name: 'phone', type: 'text' },
		{ name: 'birthDate', type: 'date' },
		{ name: 'tags', type: 'text', hasMany: true },
		{ name: 'vip', type: 'checkbox' },
		{
			name: 'tier',
			type: 'select',
			options: [
				{ label: 'Gold tier', value: 'gold' },
				{ label: 'Silver tier', value: 'silver' },
			],
		},
		{ name: 'company', type: 'relationship', relationTo: 'companies' },
		// A customer pointing at another one, for a merge to drop a pointer at its own group.
		{ name: 'referredBy', type: 'relationship', relationTo: 'customers' },
		{ name: 'internalNote', type: 'text', admin: { hidden: true } },
		// Readers whose email starts with `limited` may not read it, for the field access tests.
		{
			name: 'creditLimit',
			type: 'number',
			access: {
				read: ({ req }) =>
					!String((req.user as { email?: string } | null)?.email ?? '').startsWith('limited'),
			},
		},
		// The host's own sidebar, for the plugin's panel to sit beside.
		{
			name: 'status',
			type: 'select',
			defaultValue: 'active',
			options: ['lead', 'active', 'churned'],
			admin: { position: 'sidebar' },
		},
		{
			name: 'accountManager',
			type: 'relationship',
			relationTo: 'users',
			admin: { position: 'sidebar' },
		},
		{ name: 'lastContactedAt', type: 'date', admin: { position: 'sidebar' } },
		{
			name: 'addresses',
			type: 'array',
			fields: [
				{ name: 'city', type: 'text' },
				{ name: 'street', type: 'text' },
			],
		},
		// Labels of their own, translated, and a collapsible: the merge screen names these fields
		// as the list's filter does, `Customer profile > Rating > Score`.
		{
			name: 'profile',
			type: 'group',
			label: { en: 'Customer profile', de: 'Kundenprofil' },
			fields: [
				{ name: 'bio', type: 'textarea', localized: true },
				{
					type: 'collapsible',
					label: { en: 'Rating', de: 'Bewertung' },
					fields: [{ name: 'score', type: 'number', label: { en: 'Score', de: 'Punkte' } }],
				},
			],
		},
		{
			type: 'tabs',
			tabs: [
				{ label: 'Meta', fields: [{ name: 'note', type: 'text' }] },
				{
					name: 'extra',
					label: 'Extra',
					fields: [{ name: 'code', type: 'text', label: 'Internal code' }],
				},
			],
		},
	],
}
