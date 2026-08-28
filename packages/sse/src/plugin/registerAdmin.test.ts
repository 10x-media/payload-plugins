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
	admin: true,
	heartbeatMs: 15_000,
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

const titleCell = (config: Config): unknown => {
	const posts = config.collections?.find((c) => c.slug === 'posts')
	const title = posts?.fields?.find((f) => 'name' in f && f.name === 'title')
	if (!title || !('admin' in title)) return undefined
	return title.admin?.components?.Cell
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

		expect(titleCell(config)).toBe(LIVE_LIST_CELL_PATH)
		expect(beforeListTable(config)).toContainEqual({
			clientProps: { collection: 'posts' },
			path: LIVE_LIST_SYNC_PATH,
		})
		expect(beforeControls(config)).toContainEqual({ path: DOCUMENT_PRESENCE_PATH })
	})

	it('registers nothing when admin is omitted', () => {
		const config = postsConfig()
		registerAdmin({ config, options: { ...baseOptions(), admin: undefined } })

		expect(titleCell(config)).toBeUndefined()
		expect(beforeListTable(config)).toEqual([])
		expect(beforeControls(config)).toEqual([])
	})

	it('registers nothing when admin is false', () => {
		const config = postsConfig()
		registerAdmin({ config, options: { ...baseOptions(), admin: false } })

		expect(titleCell(config)).toBeUndefined()
		expect(beforeListTable(config)).toEqual([])
		expect(beforeControls(config)).toEqual([])
	})

	it('skips Cell and beforeListTable when admin.liveList is false', () => {
		const config = postsConfig()
		registerAdmin({
			config,
			options: { ...baseOptions(), admin: { liveList: false } },
		})

		expect(titleCell(config)).toBeUndefined()
		expect(beforeListTable(config)).toEqual([])
		expect(beforeControls(config)).toContainEqual({ path: DOCUMENT_PRESENCE_PATH })
	})

	it('skips DocumentPresence when plugin presence is off', () => {
		const config = postsConfig()
		registerAdmin({
			config,
			options: { ...baseOptions(), presence: false, admin: true },
		})

		expect(titleCell(config)).toBe(LIVE_LIST_CELL_PATH)
		expect(beforeListTable(config)).toContainEqual({
			clientProps: { collection: 'posts' },
			path: LIVE_LIST_SYNC_PATH,
		})
		expect(beforeControls(config)).toEqual([])
	})

	it('skips DocumentPresence when admin.presence is false', () => {
		const config = postsConfig()
		registerAdmin({
			config,
			options: { ...baseOptions(), admin: { presence: false } },
		})

		expect(titleCell(config)).toBe(LIVE_LIST_CELL_PATH)
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

		expect(titleCell(config)).toBe('host#ExistingCell')
		expect(beforeListTable(config)).toContainEqual({
			clientProps: { collection: 'posts' },
			path: LIVE_LIST_SYNC_PATH,
		})
	})
})
