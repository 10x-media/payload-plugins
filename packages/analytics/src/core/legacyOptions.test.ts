import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { memoryAdapter } from '../testing/memoryAdapter'
import {
	assertNoLegacyOptions,
	LEGACY_NATIVE_OPTIONS,
	LEGACY_OPTIONS,
	type LegacyOption,
	legacyOptionsIn,
	UPGRADE_GUIDE_OPTIONS,
	UPGRADE_GUIDE_URL,
} from './legacyOptions'
import { resolveOptions } from './options'

/** A config carrying `path` and nothing else that could fail the boot. */
const configWith = (path: string): Record<string, unknown> => {
	const config: Record<string, unknown> = { adapters: [memoryAdapter()] }
	const keys = path.split('.')
	let target = config
	for (const key of keys.slice(0, -1)) {
		const next: Record<string, unknown> = {}
		target[key] = next
		target = next
	}
	target[keys[keys.length - 1] as string] = () => null
	return config
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const pathsOf = (entries: readonly LegacyOption[]): string[] => entries.map((entry) => entry.path)

/** The options published 1.0.0-beta.11 took that this release renamed or removed. */
const BETA_11_PATHS = [
	'scopeResolver',
	'scopes',
	'access.platformRead',
	'capture.consent',
	'sync.collectionSlug',
	'sync.hidden',
	'sync.cron',
	'cache.warm.cron',
	'goals.collection.enabled',
]

/** Names the pre-release tree used that no published beta ever accepted. */
const UNRELEASED_PATHS = [
	'access.scopes',
	'sync.overrides',
	'view.countryFlags',
	'reportingCurrency',
	'convertCurrency',
	'revenue.enabled',
	'revenue.wire',
	'providers.collection.hosts',
]

describe('LEGACY_OPTIONS', () => {
	it('marks exactly the options beta.11 shipped as released, each removed in beta.12', () => {
		expect(pathsOf(UPGRADE_GUIDE_OPTIONS).sort()).toEqual([...BETA_11_PATHS].sort())
		for (const entry of UPGRADE_GUIDE_OPTIONS) {
			expect(entry.released && entry.removedIn).toBe('1.0.0-beta.12')
		}
	})

	it('keeps the names that never shipped out of the upgrade guide', () => {
		const unreleased = LEGACY_OPTIONS.filter((entry) => !entry.released)
		expect(pathsOf(unreleased).sort()).toEqual([...UNRELEASED_PATHS].sort())
	})

	it('has the upgrade guide the errors link to list every released path with its release', () => {
		const guide = readFileSync(
			new URL('../../../../apps/docs/content/docs/analytics/upgrading/index.mdx', import.meta.url),
			'utf8'
		).split('\n')
		expect(UPGRADE_GUIDE_URL).toMatch(/\/analytics\/upgrading#removed-options$/)
		expect(guide).toContain('## Removed options')
		const released = [
			...UPGRADE_GUIDE_OPTIONS.map((entry) => ({ entry, row: `| \`${entry.path}\` |` })),
			...LEGACY_NATIVE_OPTIONS.filter((each) => each.released).map((entry) => ({
				entry,
				row: `| \`native({ ${entry.path} })\` |`,
			})),
		]
		for (const { entry, row } of released) {
			const line = guide.find((each) => each.startsWith(row))
			expect(line, row).toBeDefined()
			expect(line).toMatch(new RegExp(`\\| ${escaped(entry.released ? entry.removedIn : '')} \\|$`))
		}
	})

	it('has each release page list the paths that release removed', () => {
		const page = readFileSync(
			new URL(
				'../../../../apps/docs/content/docs/analytics/upgrading/beta-12.mdx',
				import.meta.url
			),
			'utf8'
		)
		expect(page).toContain('\n## Removed options\n')
		for (const entry of UPGRADE_GUIDE_OPTIONS) {
			expect(page).toContain(`| \`${entry.path}\` |`)
		}
		for (const entry of LEGACY_NATIVE_OPTIONS.filter((each) => each.released)) {
			expect(page).toContain(`| \`native({ ${entry.path} })\` |`)
		}
	})

	it('lists each path once, with a replacement', () => {
		const paths = pathsOf(LEGACY_OPTIONS)
		expect(new Set(paths).size).toBe(paths.length)
		for (const entry of LEGACY_OPTIONS) {
			expect(entry.replacement.length).toBeGreaterThan(0)
		}
	})
})

describe('assertNoLegacyOptions', () => {
	it.each<[string, LegacyOption]>(
		UPGRADE_GUIDE_OPTIONS.map((entry) => [entry.path, entry])
	)('fails the boot for released %s, naming its replacement, the release and the guide', (path, entry) => {
		const boot = () => assertNoLegacyOptions(configWith(path))
		expect(boot).toThrow(new RegExp(`${escaped(path)} was removed in 1\\.0\\.0-beta\\.12`))
		expect(boot).toThrow(entry.replacement)
		expect(boot).toThrow(UPGRADE_GUIDE_URL)
	})

	it.each<[string, LegacyOption]>(
		LEGACY_OPTIONS.filter((entry) => !entry.released).map((entry) => [entry.path, entry])
	)('fails the boot for unreleased %s with its replacement and no release claimed', (path, entry) => {
		const boot = () => assertNoLegacyOptions(configWith(path))
		expect(boot).toThrow(new RegExp(`${escaped(path)} is not an option, use`))
		expect(boot).toThrow(entry.replacement)
		expect(boot).not.toThrow(/removed in|Upgrade guide/)
	})

	it('fails resolveOptions for every legacy path as well', () => {
		for (const entry of LEGACY_OPTIONS) {
			expect(() => resolveOptions(configWith(entry.path) as never)).toThrow(entry.replacement)
		}
	})

	it('names every legacy path a config carries in one error, the guide once', () => {
		const config = { scopeResolver: () => null, view: { countryFlags: false } }
		expect(() => assertNoLegacyOptions(config)).toThrow(
			/scopeResolver was removed .*; view\.countryFlags is not an option, use countryFlags\. Upgrade guide: /
		)
	})

	it('passes a config that uses only current options', () => {
		expect(() =>
			assertNoLegacyOptions({
				adapters: [memoryAdapter()],
				scope: { resolve: () => null },
				access: { crossScope: () => true },
				capture: { gate: 'all' },
				sync: { collection: { slug: 'daily' } },
				goals: { collection: false },
				providers: { collection: true, hosts: { allow: [] } },
				revenue: true,
				countryFlags: false,
			})
		).not.toThrow()
	})
})

describe('LEGACY_NATIVE_OPTIONS', () => {
	const nativeTable = { legacy: LEGACY_NATIVE_OPTIONS, owner: 'native() option ' }

	it('lists the retention windows of the rollup engine, each released and removed in beta.12', () => {
		expect(pathsOf(LEGACY_NATIVE_OPTIONS)).toEqual(['retentionDays', 'rollupRetentionDays'])
		for (const entry of LEGACY_NATIVE_OPTIONS) {
			expect(entry.released && entry.removedIn).toBe('1.0.0-beta.12')
		}
	})

	it('fails the boot naming the adapter, the replacement and the guide', () => {
		const boot = () => assertNoLegacyOptions({ retentionDays: 30 }, nativeTable)
		expect(boot).toThrow(
			/^analytics: native\(\) option retentionDays was removed in 1\.0\.0-beta\.12, use retention\.rawDays/
		)
		expect(boot).toThrow(UPGRADE_GUIDE_URL)
	})

	it('names both windows in one error when a config carries both', () => {
		expect(() =>
			assertNoLegacyOptions({ retentionDays: 30, rollupRetentionDays: 365 }, nativeTable)
		).toThrow(/retentionDays was removed .*; native\(\) option rollupRetentionDays was removed/)
	})

	it('keeps the two tables apart', () => {
		expect(legacyOptionsIn({ retentionDays: 30 })).toEqual([])
		expect(legacyOptionsIn({ scopeResolver: () => null }, LEGACY_NATIVE_OPTIONS)).toEqual([])
		expect(() => assertNoLegacyOptions({ retention: { rawDays: 30 } }, nativeTable)).not.toThrow()
	})
})

describe('legacyOptionsIn', () => {
	it('ignores a legacy key left undefined, as a conditional config writes it', () => {
		expect(legacyOptionsIn({ scopeResolver: undefined, sync: { hidden: undefined } })).toEqual([])
	})

	it('looks through the forms that carry no nested options', () => {
		expect(
			legacyOptionsIn({
				goals: [],
				sync: true,
				revenue: false,
				view: false,
				providers: { collection: true },
			})
		).toEqual([])
	})

	it('finds a nested legacy key under an object form', () => {
		expect(legacyOptionsIn({ goals: { collection: { enabled: false } } })).toEqual([
			expect.objectContaining({ path: 'goals.collection.enabled' }),
		])
		expect(legacyOptionsIn({ providers: { collection: { hosts: { allow: [] } } } })).toEqual([
			expect.objectContaining({ path: 'providers.collection.hosts' }),
		])
	})
})
