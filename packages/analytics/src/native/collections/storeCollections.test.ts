import type { CollectionConfig, Config, Field, Payload, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { native } from '../nativeAdapter'
import { createEventStore } from '../store/eventStore'
import { PART_KEYS } from '../store/parts'
import { createStateStore } from '../store/stateStore'
import { aggregatesCollection } from './aggregates'
import { hitsCollection } from './hits'
import { AGGREGATES_SLUG, HITS_SLUG, STATE_SLUG, STORE_SLUGS } from './slugs'
import { stateCollection } from './state'

const collections: Array<[string, CollectionConfig]> = [
	[HITS_SLUG, hitsCollection()],
	[AGGREGATES_SLUG, aggregatesCollection()],
	[STATE_SLUG, stateCollection()],
]

const named = (fields: Field[]): Array<Field & { name: string }> =>
	fields.flatMap((field) => ('name' in field ? [field] : []))

const shapeOf = (collection: CollectionConfig): string[] =>
	named(collection.fields).map((field) => `${field.name}:${field.type}`)

const anonymous = { req: { user: null } as unknown as PayloadRequest }

describe('engine store collections', () => {
	it.each(collections)('%s is locked down for everyone, everywhere', (slug, collection) => {
		expect(collection.slug).toBe(slug)
		expect(collection.admin?.hidden).toBe(true)
		expect(collection.endpoints).toBe(false)
		expect(collection.graphQL).toBe(false)
		expect(collection.timestamps).toBe(false)
		expect(collection.lockDocuments).toBe(false)
		for (const operation of ['read', 'create', 'update', 'delete'] as const) {
			const access = collection.access?.[operation]
			expect(typeof access, operation).toBe('function')
			expect(access?.({ ...anonymous, id: 'x', data: {} } as never), operation).toBe(false)
		}
	})

	it('takes another slug with the same fields, and every store finds its model under it', () => {
		const slugs = { hits: 'site-hits', aggregates: 'site-aggregates', state: 'site-state' }
		expect(hitsCollection(slugs.hits).slug).toBe('site-hits')
		expect(shapeOf(aggregatesCollection(slugs.aggregates))).toEqual(shapeOf(aggregatesCollection()))
		expect(stateCollection(slugs.state).slug).toBe('site-state')
		const model = () => {
			const unused = async () => undefined
			return {
				collection: {
					collectionName: 'site-hits',
					insertMany: unused,
					aggregate: unused,
					findOne: unused,
					distinct: unused,
					bulkWrite: unused,
					deleteMany: unused,
					updateMany: unused,
				},
				findOneAndUpdate: unused,
				updateMany: unused,
				find: unused,
				findOne: unused,
				deleteMany: unused,
				deleteOne: unused,
				bulkWrite: unused,
				distinct: unused,
			}
		}
		const payload = {
			db: {
				name: 'mongoose',
				collections: {
					[slugs.hits]: model(),
					[slugs.aggregates]: model(),
					[slugs.state]: model(),
				},
			},
		} as unknown as Payload
		expect(() => createEventStore(payload, { slugs })).not.toThrow()
		expect(() => createStateStore(payload, { slug: slugs.state })).not.toThrow()
		expect(() => createEventStore(payload)).toThrow(`"${HITS_SLUG}"`)
		expect(() => createStateStore(payload)).toThrow(`"${STATE_SLUG}"`)
	})

	it.each(collections)('%s keys its rows by a text id the engine picks', (_slug, collection) => {
		expect(named(collection.fields)[0]).toEqual({ name: 'id', type: 'text' })
	})

	it.each(collections)('%s keeps a scope that is never null', (_slug, collection) => {
		expect(named(collection.fields).find((field) => field.name === 'scope')).toEqual({
			name: 'scope',
			type: 'text',
			required: true,
			defaultValue: '',
		})
	})

	it('gives hits exactly the columns of a raw hit and one index, scope then time', () => {
		const hits = hitsCollection()
		expect(shapeOf(hits)).toEqual([
			'id:text',
			'scope:text',
			'ts:date',
			'lastAt:date',
			'type:text',
			'hostname:text',
			'path:text',
			'v:text',
			'landing:checkbox',
			'server:checkbox',
			'name:text',
			'ref:text',
			'source:text',
			'channel:text',
			'clickId:text',
			'utmSource:text',
			'utmMedium:text',
			'utmCampaign:text',
			'utmContent:text',
			'utmTerm:text',
			'channelVersion:number',
			'country:text',
			'region:text',
			'city:text',
			'language:text',
			'device:text',
			'browser:text',
			'os:text',
			'durationMs:number',
			'scrollDepth:number',
			'value:number',
			'originalValue:number',
			'conversions:number',
			'revenue:number',
			'currency:text',
			'originalCurrency:text',
			'item:text',
			'props:json',
			'goals:json',
			'impressions:json',
		])
		expect(hits.indexes).toEqual([{ fields: ['scope', 'ts'] }])
		const required = named(hits.fields)
			.filter((field) => 'required' in field && field.required)
			.map((field) => field.name)
		expect(required).toEqual(['scope', 'ts', 'type', 'hostname', 'path', 'v', 'landing', 'server'])
	})

	it('gives aggregates the key, the run and one nullable column per metric part', () => {
		const aggregates = aggregatesCollection()
		expect(shapeOf(aggregates)).toEqual([
			'id:text',
			'scope:text',
			'day:number',
			'hostname:text',
			'dim:text',
			'value:text',
			'dim2:text',
			'value2:text',
			'gen:text',
			...PART_KEYS.map((part) => `${part}:number`),
		])
		expect(aggregates.indexes).toEqual([
			{ fields: ['scope', 'dim', 'dim2', 'day'] },
			{ fields: ['scope', 'dim', 'value', 'day'] },
		])
		for (const part of named(aggregates.fields).filter((field) =>
			PART_KEYS.some((key) => key === field.name)
		)) {
			expect('required' in part && part.required, part.name).toBeFalsy()
		}
	})

	it('gives state the columns of salts, markers, leases and heartbeats, and its two indexes', () => {
		const state = stateCollection()
		expect(shapeOf(state)).toEqual([
			'id:text',
			'kind:text',
			'scope:text',
			'day:number',
			'tz:text',
			'status:text',
			'version:number',
			'gen:text',
			'hits:number',
			'leaseOwner:text',
			'leaseUntil:date',
			'finalAfter:date',
			'aggregatedAt:date',
			'value:json',
			'expiresAt:date',
		])
		expect(state.indexes).toEqual([
			{ fields: ['kind', 'status', 'day'] },
			{ fields: ['kind', 'scope', 'day'] },
		])
	})

	it('is what native() registers, and all it registers', () => {
		const config = {} as Config
		native().register?.(config)
		const slugs = (config.collections ?? []).map((collection) => collection.slug)
		expect(slugs).toEqual([...STORE_SLUGS])
		expect(STORE_SLUGS).toEqual([HITS_SLUG, AGGREGATES_SLUG, STATE_SLUG])
	})
})
