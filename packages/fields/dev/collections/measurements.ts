import type { CollectionConfig } from 'payload'
import { measurementField } from '../../src/exports/measurement'

export const measurements: CollectionConfig = {
	slug: 'measurements',
	admin: { useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{
			type: 'row',
			fields: [
				{ name: 'nativeNumber', type: 'number', admin: { width: '50%' } },
				measurementField({
					usage: 'bodyWeight',
					overrides: ({ field }) => ({ ...field, admin: { ...field.admin, width: '50%' } }),
				}),
			],
		},
		measurementField({
			name: 'height',
			usage: 'personHeight',
			overrides: ({ field }) => ({
				...field,
				admin: { ...field.admin, description: 'Compound ft+in entry when toggled imperial' },
			}),
		}),
		measurementField({ usage: 'distance' }),
		measurementField({ name: 'load', usage: 'mass' }),
		measurementField({ name: 'wingspan', storageUnit: 'cm', usage: 'length' }),
		measurementField({ usage: 'volume' }),
		measurementField({ usage: 'temperature' }),
		measurementField({ usage: 'speed' }),
		measurementField({ defaultUnit: 'lb', name: 'poundsFirst', usage: 'bodyWeight' }),
		measurementField({ name: 'kgOnly', units: ['kg'], usage: 'bodyWeight' }),
		measurementField({
			max: 250,
			min: 30,
			name: 'boundedWeight',
			required: true,
			usage: 'bodyWeight',
		}),
		measurementField({
			name: 'readOnlyWeight',
			usage: 'bodyWeight',
			overrides: ({ field }) => ({ ...field, admin: { ...field.admin, readOnly: true } }),
		}),
		measurementField({ localized: true, name: 'localizedDistance', usage: 'distance' }),
	],
}
