import type { CollectionConfig, Field } from 'payload'
import { HITS_SLUG } from './slugs'
import { storeCollection } from './storeCollection'

const text = (name: string): Field => ({ name, type: 'text' })
const number = (name: string): Field => ({ name, type: 'number' })
const json = (name: string): Field => ({ name, type: 'json' })
const flag = (name: string): Field => ({
	name,
	type: 'checkbox',
	required: true,
	defaultValue: false,
})

/**
 * One row per hit, keyed by a ULID of its time or `o` + an order's dedupe key, which is what
 * refuses a retried order. `type` is text, so a new hit type needs no Postgres enum migration.
 */
export const hitsCollection = (slug: string = HITS_SLUG): CollectionConfig =>
	storeCollection({
		slug,
		fields: [
			{ name: 'scope', type: 'text', required: true, defaultValue: '' },
			{ name: 'ts', type: 'date', required: true },
			{ name: 'lastAt', type: 'date' },
			{ name: 'type', type: 'text', required: true },
			{ name: 'hostname', type: 'text', required: true },
			{ name: 'path', type: 'text', required: true },
			{ name: 'v', type: 'text', required: true },
			flag('landing'),
			flag('server'),
			text('mode'),
			text('name'),
			text('ref'),
			text('source'),
			text('channel'),
			text('clickId'),
			text('utmSource'),
			text('utmMedium'),
			text('utmCampaign'),
			text('utmContent'),
			text('utmTerm'),
			number('channelVersion'),
			text('country'),
			text('region'),
			text('city'),
			text('language'),
			text('device'),
			text('browser'),
			text('os'),
			number('durationMs'),
			number('scrollDepth'),
			number('value'),
			number('originalValue'),
			number('conversions'),
			number('revenue'),
			text('currency'),
			text('originalCurrency'),
			text('item'),
			json('props'),
			json('goals'),
			json('impressions'),
		],
		indexes: [{ fields: ['scope', 'ts'] }],
	})
