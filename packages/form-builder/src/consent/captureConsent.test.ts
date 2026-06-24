import { describe, expect, it } from 'vitest'
import { captureConsent } from './captureConsent'
import type { AnyConsentSource } from './defineConsentSource'
import type { ConsentSourceRegistry } from './registry'

const payload = {} as never
const now = '2026-01-01T00:00:00.000Z'

const makeRegistry = (entries: Record<string, AnyConsentSource>): ConsentSourceRegistry =>
	new Map(Object.entries(entries))

const staticSource: AnyConsentSource = {
	type: 'static',
	label: 'Static',
	resolve: ({ config }) => ({
		links: [{ label: String(config.label ?? ''), url: String(config.url ?? '') }],
	}),
}

const versionedSource: AnyConsentSource = {
	type: 'versioned',
	label: 'Versioned',
	resolve: () => ({
		links: [{ label: 'TOS', url: '/tos' }],
		versionRef: 'v3',
	}),
}

describe('captureConsent', () => {
	it('agreed:true + static source -> includes ref', async () => {
		const registry = makeRegistry({ static: staticSource })
		const field = {
			blockType: 'consent',
			name: 'gdpr',
			source: 'static',
			sourceConfig: { label: 'Privacy', url: '/privacy' },
		}
		const result = await captureConsent({
			field,
			agreed: true,
			registry,
			payload,
			locale: 'en',
			now,
		})
		expect(result).toEqual({ agreed: true, ref: '/privacy', at: now })
	})

	it('agreed:false -> records agreed false, still re-resolves ref', async () => {
		const registry = makeRegistry({ static: staticSource })
		const field = {
			blockType: 'consent',
			name: 'gdpr',
			source: 'static',
			sourceConfig: { label: 'Privacy', url: '/privacy' },
		}
		const result = await captureConsent({
			field,
			agreed: false,
			registry,
			payload,
			locale: 'en',
			now,
		})
		expect(result).toEqual({ agreed: false, ref: '/privacy', at: now })
	})

	it('source with versionRef -> versionRef is captured', async () => {
		const registry = makeRegistry({ versioned: versionedSource })
		const field = { blockType: 'consent', name: 'tos', source: 'versioned' }
		const result = await captureConsent({
			field,
			agreed: true,
			registry,
			payload,
			locale: 'en',
			now,
		})
		expect(result).toEqual({ agreed: true, ref: '/tos', versionRef: 'v3', at: now })
	})

	it('unknown source -> no ref, no versionRef', async () => {
		const registry = makeRegistry({ static: staticSource })
		const field = { blockType: 'consent', name: 'gdpr', source: 'unknown' }
		const result = await captureConsent({
			field,
			agreed: true,
			registry,
			payload,
			locale: 'en',
			now,
		})
		expect(result).toEqual({ agreed: true, at: now })
	})

	it('source with empty url -> no ref property', async () => {
		const emptyUrlSource: AnyConsentSource = {
			type: 'nourl',
			label: 'No URL',
			resolve: () => ({ links: [{ label: 'TOS', url: '' }] }),
		}
		const registry = makeRegistry({ nourl: emptyUrlSource })
		const field = { blockType: 'consent', name: 'tos', source: 'nourl' }
		const result = await captureConsent({
			field,
			agreed: true,
			registry,
			payload,
			locale: 'en',
			now,
		})
		expect(result).not.toHaveProperty('ref')
		expect(result.at).toBe(now)
	})

	it('proof param signature has no clientRef slot', () => {
		const args = {
			field: { blockType: 'consent', name: 'x' },
			agreed: true,
			registry: new Map(),
			payload,
			locale: 'en',
			now,
		} satisfies Parameters<typeof captureConsent>[0]
		expect(Object.keys(args)).not.toContain('clientRef')
	})
})
