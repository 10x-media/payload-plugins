import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import type { ResolvedSSEOptions } from '../options'
import {
	DOCUMENT_PRESENCE_PATH,
	LIVE_LIST_CELL_PATH,
	LIVE_LIST_SYNC_PATH,
	registerAdmin,
} from './registerAdmin'

const baseOptions = (): ResolvedSSEOptions => ({
	collections: {
		posts: { thinEvents: true, events: ['create', 'update', 'delete'] },
	},
	presence: {
		heartbeatMs: 10_000,
		leaseMs: 30_000,
		identify: (user) => ({ id: String((user as { id: unknown }).id), label: 'x' }),
	},
	admin: { liveList: {}, presence: true },
	heartbeatMs: 15_000,
	maxConnectionsPerUser: 8,
	broker: undefined,
	translations: undefined,
	scope: false,
})

const postsConfig = (): Config =>
	({
		collections: [
			{
				slug: 'posts',
				fields: [{ name: 'title', type: 'text' }],
			},
		],
	}) as Config

const fieldCell = (config: Config, name: string): unknown => {
	const posts = config.collections?.find((c) => c.slug === 'posts')
	const field = posts?.fields?.find((f) => 'name' in f && f.name === name)
	if (!field || !('admin' in field)) return undefined
	return field.admin?.components?.Cell
}

const beforeListTable = (config: Config): unknown[] => {
	const posts = config.collections?.find((c) => c.slug === 'posts')
	return posts?.admin?.components?.beforeListTable ?? []
}

const beforeControls = (config: Config): unknown[] => {
	const posts = config.collections?.find((c) => c.slug === 'posts')
	return posts?.admin?.components?.edit?.beforeDocumentControls ?? []
}

describe('registerAdmin', () => {
	it('attaches LiveListBadge Cell, LiveListSync beforeListTable, and DocumentPresence', () => {
		const config = postsConfig()
		registerAdmin({ config, options: baseOptions() })

		expect(fieldCell(config, 'title')).toBe(LIVE_LIST_CELL_PATH)
		expect(beforeListTable(config)).toContainEqual({
			clientProps: { collection: 'posts' },
			path: LIVE_LIST_SYNC_PATH,
		})
		expect(beforeControls(config)).toContainEqual({ path: DOCUMENT_PRESENCE_PATH })
	})

	it('registers nothing when admin flags are both off', () => {
		const config = postsConfig()
		registerAdmin({
			config,
			options: { ...baseOptions(), admin: { liveList: false, presence: false } },
		})

		expect(fieldCell(config, 'title')).toBeUndefined()
		expect(beforeListTable(config)).toEqual([])
		expect(beforeControls(config)).toEqual([])
	})

	it('skips Cell and beforeListTable when admin.liveList is false', () => {
		const config = postsConfig()
		registerAdmin({
			config,
			options: { ...baseOptions(), admin: { liveList: false, presence: true } },
		})

		expect(fieldCell(config, 'title')).toBeUndefined()
		expect(beforeListTable(config)).toEqual([])
		expect(beforeControls(config)).toContainEqual({ path: DOCUMENT_PRESENCE_PATH })
	})

	it('skips DocumentPresence when admin.presence is false', () => {
		const config = postsConfig()
		registerAdmin({
			config,
			options: { ...baseOptions(), admin: { liveList: {}, presence: false } },
		})

		expect(fieldCell(config, 'title')).toBe(LIVE_LIST_CELL_PATH)
		expect(beforeListTable(config)).toContainEqual({
			clientProps: { collection: 'posts' },
			path: LIVE_LIST_SYNC_PATH,
		})
		expect(beforeControls(config)).toEqual([])
	})

	it('skips LiveListBadge when the target field already has a Cell, still mounts LiveListSync', () => {
		const config = {
			collections: [
				{
					slug: 'posts',
					fields: [
						{
							name: 'title',
							type: 'text',
							admin: { components: { Cell: 'host#ExistingCell' } },
						},
					],
				},
			],
		} as Config

		registerAdmin({ config, options: baseOptions() })

		expect(fieldCell(config, 'title')).toBe('host#ExistingCell')
		expect(beforeListTable(config)).toContainEqual({
			clientProps: { collection: 'posts' },
			path: LIVE_LIST_SYNC_PATH,
		})
	})

	it('does not put a Cell on a richText first field', () => {
		const config = {
			collections: [
				{
					slug: 'posts',
					fields: [{ name: 'body', type: 'richText' }],
				},
			],
		} as Config

		registerAdmin({ config, options: baseOptions() })

		expect(fieldCell(config, 'body')).toBeUndefined()
		expect(beforeListTable(config)).toContainEqual({
			clientProps: { collection: 'posts' },
			path: LIVE_LIST_SYNC_PATH,
		})
	})

	it('targets admin.liveList.field when supplied', () => {
		const config = {
			collections: [
				{
					slug: 'posts',
					fields: [
						{ name: 'id', type: 'text' },
						{ name: 'title', type: 'text' },
					],
				},
			],
		} as Config

		registerAdmin({
			config,
			options: {
				...baseOptions(),
				admin: { liveList: { field: 'title' }, presence: false },
			},
		})

		expect(fieldCell(config, 'id')).toBeUndefined()
		expect(fieldCell(config, 'title')).toBe(LIVE_LIST_CELL_PATH)
	})
})
