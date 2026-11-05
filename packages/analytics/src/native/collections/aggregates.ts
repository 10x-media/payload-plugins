import type { CollectionConfig, Field } from 'payload'
import { PART_KEYS } from '../store/parts'
import { AGGREGATES_SLUG } from './slugs'
import { storeCollection } from './storeCollection'

const key = (name: string): Field => ({ name, type: 'text', required: true, defaultValue: '' })

/**
 * One row per scope, local day, hostname and one or two dimension values (`''` for none), keyed by
 * a hash of that key; `gen` is the run that wrote it, and a null part is one its kind never counts.
 */
export const aggregatesCollection = (slug: string = AGGREGATES_SLUG): CollectionConfig =>
	storeCollection({
		slug,
		fields: [
			key('scope'),
			{ name: 'day', type: 'number', required: true },
			key('hostname'),
			key('dim'),
			key('value'),
			key('dim2'),
			key('value2'),
			{ name: 'gen', type: 'text', required: true },
			...PART_KEYS.map((part): Field => ({ name: part, type: 'number' })),
		],
		indexes: [
			{ fields: ['scope', 'dim', 'dim2', 'day'] },
			{ fields: ['scope', 'dim', 'value', 'day'] },
		],
	})
