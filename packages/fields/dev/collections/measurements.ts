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
		measurementField({
			units: ['in', 'ft-in'],
			storageUnit: 'mm',
			preferenceKey: 'cutout',
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					description: 'Free-form: inches only, stored in millimetres, its own preference bucket',
				},
			}),
		}),
		measurementField({
			units: ['km', 'mi', 'nmi'],
			storageUnit: 'km',
			preferenceKey: 'sailing',
			custom: {
				units: { nmi: { dimension: 'length', factor: 1852, intlUnit: null, shortLabel: 'nmi' } },
			},
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					description:
						'Free-form with a custom unit (nmi, 1 nmi = 1852 m). No Intl unit for nmi, so it formats as a plain decimal plus shortLabel',
				},
			}),
		}),
		measurementField({
			...presets.mass,
			name: 'labSample',
			precision: 'exact',
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					description:
						'Exact mode: free entry (no quantize), faithful drafts, cells read back at full storage precision',
				},
			}),
		}),
		measurementField({
			name: 'shippingWeight',
			preferenceKey: 'shippingWeight',
			storageUnit: 'g',
			units: ['g', 'kg'],
			precision: { mode: 'readable', storage: 0 },
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					description:
						'Readable mode with storage rounded to whole grams: the granularity contract runs on every write, regardless of what produced the number',
				},
			}),
		}),
	],
}
