import type { CollectionConfig } from 'payload'
import { colorField, presetsFromDoc } from '../../src/exports/color'
import type { ColorPreset, FieldsResolverArgs } from '../../src/types'

type TenantDoc = {
	brandColors?: Array<{ key: string; label?: null | string; value: string }> | null
	name: string
}

/** req-only on purpose: linked resolvers are memoized per request (see plan deviation 6). */
const tenantBrandPresets = async ({ req }: FieldsResolverArgs): Promise<ColorPreset[]> => {
	const result = await req.payload.find({ collection: 'tenants', depth: 0, limit: 25 })
	return result.docs.flatMap((doc) => {
		const tenant = doc as unknown as TenantDoc
		return [
			...presetsFromDoc({
				collection: 'tenants',
				doc: doc as unknown as Record<string, unknown>,
				fields: ['primary', 'accent'],
				keyPrefix: `${tenant.name}/`,
				req,
			}),
			...(tenant.brandColors ?? []).map((color) => ({
				key: `${tenant.name}/${color.key}`,
				label: color.label ?? color.key,
				value: color.value,
			})),
		]
	})
}

const staticPresets: ColorPreset[] = [
	'#0f172a',
	'#f8fafc',
	{ key: 'brand', label: { de: 'Markenblau', en: 'Brand blue' }, value: '#0ea5e9' },
	{ key: 'accent', label: { de: 'Akzent', en: 'Accent' }, value: 'oklch(0.72 0.19 145)' },
]

export const colors: CollectionConfig = {
	slug: 'colors',
	admin: { useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{
			type: 'row',
			fields: [
				{ name: 'nativeText', type: 'text', admin: { width: '50%' } },
				colorField({
					name: 'hexDefault',
					overrides: ({ field }) => ({ ...field, admin: { ...field.admin, width: '50%' } }),
				}),
			],
		},
		{
			type: 'row',
			fields: [
				colorField({
					name: 'rgbFormat',
					format: 'rgb',
					overrides: ({ field }) => ({ ...field, admin: { ...field.admin, width: '50%' } }),
				}),
				colorField({
					name: 'hslFormat',
					format: 'hsl',
					overrides: ({ field }) => ({ ...field, admin: { ...field.admin, width: '50%' } }),
				}),
			],
		},
		colorField({ name: 'oklchFormat', format: 'oklch' }),
		colorField({ name: 'noAlpha', alpha: false }),
		colorField({ name: 'noEyedropper', enableEyedropper: false }),
		colorField({ name: 'notClearable', isClearable: false }),
		colorField({
			name: 'withPresets',
			presets: staticPresets,
			presetsLabel: { de: 'Markenpalette', en: 'Brand palette' },
		}),
		colorField({ name: 'pluginPresets' }),
		colorField({ name: 'requiredColor', required: true }),
		colorField({
			name: 'readOnlyColor',
			overrides: ({ field }) => ({ ...field, admin: { ...field.admin, readOnly: true } }),
		}),
		colorField({ name: 'localizedColor', localized: true }),
		...colorField({ linked: true, name: 'linkedStatic', presets: staticPresets }),
		...colorField({
			linked: { fallback: '#94a3b8' },
			name: 'linkedTenant',
			presets: tenantBrandPresets,
		}),
	],
}
