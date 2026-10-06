import type { PayloadRequest, SanitizedPermissions } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { type ResolvedOverlay, resolveOptions } from '../plugin/resolveOptions'
import type { HiddenPredicates, SettingsOverlayConfig } from '../types'
import type { EntityLookup } from './entityLabels'
import { buildManifest } from './manifest'

const entities: EntityLookup = {
	collection: (slug) =>
		slug === 'tags' ? { group: 'Content', label: { en: 'Tags' } } : { label: slug },
	global: (slug) => ({ label: { en: 'Branding' }, ...(slug ? {} : {}) }),
}

const permissions = {
	collections: {
		locked: { read: false },
		sites: { read: true },
		tags: { read: true },
	},
	globals: { branding: { read: true } },
} as unknown as SanitizedPermissions

const req = {
	payload: { logger: { error: vi.fn() } },
	user: { id: 'u1' },
} as unknown as PayloadRequest

const build = (
	overlay: SettingsOverlayConfig,
	extra: {
		groupPrefs?: Record<string, { open?: boolean }>
		hiddenPredicates?: HiddenPredicates
	} = {}
) =>
	buildManifest({
		entities,
		locale: 'en',
		overlay: resolveOptions({ overlays: [overlay] }).overlays[0] as ResolvedOverlay,
		permissions,
		req,
		translate: (label) => (typeof label === 'string' ? label : (label.en ?? '')),
		...extra,
	})

describe('buildManifest', () => {
	it('puts the ungrouped block first and keeps declared order inside a group', async () => {
		const manifest = await build({
			id: 'system',
			items: [
				{ slug: 'tags', type: 'collection' },
				{ href: '/a', label: 'Account', slug: 'account', type: 'link' },
				{ group: 'Content', label: 'Sites', slug: 'sites', type: 'collection' },
			],
			label: 'System',
		})

		expect(manifest.groups.map((group) => group.label)).toEqual([null, 'Content'])
		expect(manifest.groups[0]?.items.map((item) => item.slug)).toEqual(['account'])
		expect(manifest.groups[1]?.items.map((item) => item.slug)).toEqual(['tags', 'sites'])
	})

	it('drops an item the reader cannot read', async () => {
		const manifest = await build({
			id: 'system',
			items: [
				{ slug: 'tags', type: 'collection' },
				{ slug: 'locked', type: 'collection' },
			],
			label: 'System',
		})
		expect(manifest.groups.flatMap((group) => group.items).map((item) => item.slug)).toEqual([
			'tags',
		])
	})

	it('drops an item whose access says no, and fails closed when it throws', async () => {
		const manifest = await build({
			id: 'system',
			items: [
				{ access: () => false, href: '/a', label: 'A', slug: 'a', type: 'link' },
				{
					access: () => {
						throw new Error('boom')
					},
					href: '/b',
					label: 'B',
					slug: 'b',
					type: 'link',
				},
				{ href: '/c', label: 'C', slug: 'c', type: 'link' },
			],
			label: 'System',
		})
		expect(manifest.groups.flatMap((group) => group.items).map((item) => item.slug)).toEqual(['c'])
	})

	it('honours a lifted admin.hidden predicate', async () => {
		const manifest = await build(
			{ id: 'system', items: [{ slug: 'tags', type: 'collection' }], label: 'System' },
			{ hiddenPredicates: { collections: { tags: () => true }, globals: {} } }
		)
		expect(manifest.groups).toHaveLength(0)
	})

	it('resolves a direct document id and reports it on the row', async () => {
		const manifest = await build({
			id: 'system',
			items: [{ resolveDocID: () => 'doc-1', slug: 'tags', type: 'collection' }],
			label: 'System',
		})
		expect(manifest.groups[0]?.items[0]?.directDocID).toBe('doc-1')
	})

	it("normalises the resolver's 'create' to the token the panel writes into the URL", async () => {
		const manifest = await build({
			id: 'system',
			items: [{ resolveDocID: () => 'create', slug: 'tags', type: 'collection' }],
			label: 'System',
		})
		expect(manifest.groups[0]?.items[0]?.directDocID).toBe('new')
	})

	it('falls back to the list when resolveDocID returns null or throws', async () => {
		const nulled = await build({
			id: 'system',
			items: [{ resolveDocID: () => null, slug: 'tags', type: 'collection' }],
			label: 'System',
		})
		expect(nulled.groups[0]?.items[0]?.directDocID).toBeUndefined()

		const threw = await build({
			id: 'system',
			items: [
				{
					resolveDocID: () => {
						throw new Error('boom')
					},
					slug: 'tags',
					type: 'collection',
				},
			],
			label: 'System',
		})
		expect(threw.groups[0]?.items[0]?.directDocID).toBeUndefined()
	})

	it('sorts items by their own order, leaving unkeyed rows where they were', async () => {
		const manifest = await build({
			id: 'system',
			items: [
				{ href: '/a', label: 'A', order: 20, slug: 'a', type: 'link' },
				{ href: '/b', label: 'B', slug: 'b', type: 'link' },
				{ href: '/c', label: 'C', order: 10, slug: 'c', type: 'link' },
			],
			label: 'System',
		})
		expect(manifest.groups[0]?.items.map((item) => item.slug)).toEqual(['c', 'a', 'b'])
	})

	it('sorts groups through the sort config', async () => {
		const manifest = await build({
			id: 'system',
			items: [
				{ group: 'Zed', href: '/a', label: 'A', slug: 'a', type: 'link' },
				{ group: 'Alpha', href: '/b', label: 'B', slug: 'b', type: 'link' },
			],
			label: 'System',
			sort: { groups: (group) => group.label ?? undefined },
		})
		expect(manifest.groups.map((group) => group.label)).toEqual(['Alpha', 'Zed'])
	})

	it('marks a group the reader collapsed, and leaves the rest alone', async () => {
		const overlay: SettingsOverlayConfig = {
			id: 'system',
			items: [
				{ group: 'Content', href: '/a', label: 'A', slug: 'a', type: 'link' },
				{ group: 'Other', href: '/b', label: 'B', slug: 'b', type: 'link' },
			],
			label: 'System',
		}

		const collapsed = await build(overlay, { groupPrefs: { Content: { open: false } } })
		expect(collapsed.groups.find((group) => group.label === 'Content')?.open).toBe(false)
		expect(collapsed.groups.find((group) => group.label === 'Other')?.open).toBeUndefined()

		const untouched = await build(overlay)
		expect(untouched.groups.every((group) => group.open === undefined)).toBe(true)
	})

	it('never marks the ungrouped block collapsed, since it has no heading to reopen it by', async () => {
		const manifest = await build(
			{
				id: 'system',
				items: [{ href: '/a', label: 'A', slug: 'a', type: 'link' }],
				label: 'System',
			},
			{ groupPrefs: { '': { open: false } } }
		)
		expect(manifest.groups[0]?.label).toBeNull()
		expect(manifest.groups[0]?.open).toBeUndefined()
	})

	it('carries badges and keywords through to the rail', async () => {
		const manifest = await build({
			id: 'system',
			items: [
				{
					badge: { type: 'collection-count' },
					keywords: ['labels'],
					slug: 'tags',
					type: 'collection',
				},
			],
			label: 'System',
		})
		const item = manifest.groups[0]?.items[0]
		expect(item?.badge).toEqual({ type: 'collection-count' })
		expect(item?.keywords).toEqual(['labels'])
	})
})
