import { describe, expect, it } from 'vitest'
import type { AnyConsentSource } from './defineConsentSource'
import type { ConsentSourceRegistry } from './registry'
import { resolveConsentLinks } from './resolveConsentLinks'

const payload = {} as never
const baseCtx = { payload, locale: 'en' }

const makeRegistry = (entries: Record<string, AnyConsentSource>): ConsentSourceRegistry =>
	new Map(Object.entries(entries))

const staticSource: AnyConsentSource = {
	type: 'static',
	label: 'Static',
	resolve: ({ config }) => ({
		links: [{ label: String(config.label ?? ''), url: String(config.url ?? '') }],
	}),
}

const versionSource: AnyConsentSource = {
	type: 'versioned',
	label: 'Versioned',
	resolve: () => ({
		links: [{ label: 'TOS', url: '/tos' }],
		versionRef: 'v3',
		versionLabel: 'Version 3',
	}),
}

const throwingSource: AnyConsentSource = {
	type: 'throwing',
	label: 'Throwing',
	resolve: () => {
		throw new Error('boom')
	},
}

describe('resolveConsentLinks', () => {
	it('resolves links from a matching static source', async () => {
		const registry = makeRegistry({ static: staticSource })
		const field = {
			blockType: 'consent',
			name: 'gdpr',
			source: 'static',
			sourceConfig: { label: 'Privacy', url: '/privacy' },
		}
		const result = await resolveConsentLinks(field, { ...baseCtx, registry })
		expect(result).toEqual({ links: [{ label: 'Privacy', url: '/privacy' }] })
	})

	it('defaults to "static" source when field.source is not a string', async () => {
		const registry = makeRegistry({ static: staticSource })
		const field = {
			blockType: 'consent',
			name: 'gdpr',
			sourceConfig: { label: 'Privacy', url: '/privacy' },
		}
		const result = await resolveConsentLinks(field, { ...baseCtx, registry })
		expect(result).toEqual({ links: [{ label: 'Privacy', url: '/privacy' }] })
	})

	it('returns empty links for an unknown source', async () => {
		const registry = makeRegistry({ static: staticSource })
		const field = { blockType: 'consent', name: 'gdpr', source: 'unknown' }
		const result = await resolveConsentLinks(field, { ...baseCtx, registry })
		expect(result).toEqual({ links: [] })
	})

	it('returns empty links when registry is empty', async () => {
		const registry = makeRegistry({})
		const field = { blockType: 'consent', name: 'gdpr', source: 'static' }
		const result = await resolveConsentLinks(field, { ...baseCtx, registry })
		expect(result).toEqual({ links: [] })
	})

	it('returns empty links when source throws', async () => {
		const registry = makeRegistry({ throwing: throwingSource })
		const field = { blockType: 'consent', name: 'gdpr', source: 'throwing' }
		const result = await resolveConsentLinks(field, { ...baseCtx, registry })
		expect(result).toEqual({ links: [] })
	})

	it('passes through versionRef from the resolved source', async () => {
		const registry = makeRegistry({ versioned: versionSource })
		const field = { blockType: 'consent', name: 'tos', source: 'versioned' }
		const result = await resolveConsentLinks(field, { ...baseCtx, registry })
		expect(result.versionRef).toBe('v3')
		expect(result.versionLabel).toBe('Version 3')
		expect(result.links).toEqual([{ label: 'TOS', url: '/tos' }])
	})
})
