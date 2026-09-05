import type { CollectionConfig } from 'payload'
import { measurementField, presets } from '../../src/exports/measurement'

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
					...presets.bodyWeight,
					overrides: ({ field }) => ({ ...field, admin: { ...field.admin, width: '50%' } }),
				}),
			],
		},
		measurementField({
			...presets.personHeight,
			overrides: ({ field }) => ({
				...field,
				admin: { ...field.admin, description: 'Compound ft+in entry when toggled imperial' },
			}),
		}),
		measurementField({ ...presets.distance }),
		measurementField({ ...presets.mass, name: 'load' }),
		measurementField({ ...presets.length, name: 'wingspan' }),
		measurementField({ ...presets.volume }),
		measurementField({ ...presets.temperature }),
		measurementField({ ...presets.speed }),
		measurementField({ ...presets.bodyWeight, fallbackUnit: 'lb', name: 'poundsFirst' }),
		measurementField({ ...presets.bodyWeight, name: 'kgOnly', units: ['kg'] }),
		measurementField({
			...presets.bodyWeight,
			max: 250,
			min: 30,
			name: 'boundedWeight',
			required: true,
		}),
		measurementField({
			...presets.bodyWeight,
			name: 'readOnlyWeight',
			overrides: ({ field }) => ({ ...field, admin: { ...field.admin, readOnly: true } }),
		}),
		measurementField({ ...presets.distance, localized: true, name: 'localizedDistance' }),
	],
}
