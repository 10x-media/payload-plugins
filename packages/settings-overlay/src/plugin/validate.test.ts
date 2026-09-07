import { describe, expect, it } from 'vitest'

import { resolveOptions } from './resolveOptions'
import { type KnownEntities, validateOverlays } from './validate'

const known: KnownEntities = {
	collectionSlugs: ['tags', 'sites'],
	globalSlugs: ['branding'],
	viewKeys: ['auditLogs'],
}

const check = (overlays: Parameters<typeof resolveOptions>[0]['overlays']) => () => {
	validateOverlays(resolveOptions({ overlays }).overlays, known)
}

describe('validateOverlays', () => {
	it('accepts a config naming known entities', () => {
		expect(
			check([
				{
					id: 'system',
					items: [
						{ slug: 'tags', type: 'collection' },
						{ slug: 'branding', type: 'global' },
						{ href: '/account', label: 'Account', slug: 'account', type: 'link' },
						{ label: 'Audit', slug: 'audit', type: 'view', viewKey: 'auditLogs' },
						{ component: './A#A', label: 'A', slug: 'a', type: 'component' },
					],
					label: 'System',
				},
			])
		).not.toThrow()
	})

	it('rejects a duplicate overlay id', () => {
		expect(
			check([
				{ id: 'system', items: [], label: 'A' },
				{ id: 'system', items: [], label: 'B' },
			])
		).toThrow(/Duplicate overlay id "system"/)
	})

	it('rejects a duplicate item slug inside one overlay', () => {
		expect(
			check([
				{
					id: 'system',
					items: [
						{ slug: 'tags', type: 'collection' },
						{ href: '/x', label: 'X', slug: 'tags', type: 'link' },
					],
					label: 'System',
				},
			])
		).toThrow(/lists item slug "tags" twice/)
	})

	it('rejects an unknown collection or global', () => {
		expect(
			check([{ id: 'system', items: [{ slug: 'nope', type: 'collection' }], label: 'S' }])
		).toThrow(/unknown collection "nope"/)
		expect(
			check([{ id: 'system', items: [{ slug: 'nope', type: 'global' }], label: 'S' }])
		).toThrow(/unknown global "nope"/)
	})

	it('rejects one entity claimed by two overlays', () => {
		expect(
			check([
				{ id: 'a', items: [{ slug: 'tags', type: 'collection' }], label: 'A' },
				{ id: 'b', items: [{ slug: 'tags', type: 'collection' }], label: 'B' },
			])
		).toThrow(/listed in overlays "a" and "b"/)
	})

	it('rejects a view whose key is not registered, and says why', () => {
		expect(
			check([
				{
					id: 'system',
					items: [{ label: 'Nope', slug: 'nope', type: 'view', viewKey: 'missing' }],
					label: 'S',
				},
			])
		).toThrow(/must run before settingsOverlay/)
	})

	it('rejects a link with no leading slash', () => {
		expect(
			check([
				{
					id: 'system',
					items: [
						{ href: 'account' as `/${string}`, label: 'Account', slug: 'account', type: 'link' },
					],
					label: 'S',
				},
			])
		).toThrow(/relative to the admin route/)
	})
})
