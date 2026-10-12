import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadEncrypted } from './encrypted'
import { isModuleNotFoundError } from './peerImportError'
import {
	GA4_SDK_WARNING,
	importPeer,
	isProductionBuild,
	loadGa4,
	loadMaxmind,
	MAXMIND_SDK_WARNING,
} from './peers'

const SRC = fileURLToPath(new URL('..', import.meta.url))

/** The optional peers a host may leave out; none may be imported by a literal specifier. */
const OPTIONAL_PEER =
	/^(@google-analytics\/data|maxmind|@payloadcms\/db-[a-z0-9-]+|drizzle-orm(\/.*)?)$/

/** Every runtime module specifier a source file names: value imports, re-exports, `import()`. */
const runtimeSpecifiers = (text: string): string[] => {
	const found: string[] = []
	for (const match of text.matchAll(
		/^\s*(?:import|export)\s+(?!type\b)[^'"`]*?from\s+['"]([^'"]+)['"]/gm
	)) {
		if (match[1]) found.push(match[1])
	}
	for (const match of text.matchAll(/(?<!typeof\s*)\bimport\(\s*['"]([^'"]+)['"]/g)) {
		if (match[1]) found.push(match[1])
	}
	return found
}

const sourceFiles = (): string[] =>
	readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
		(file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)
	)

describe('importPeer', () => {
	it('imports the package its parts name, joined at runtime', async () => {
		const mod = await importPeer(['@10x-media', 'fields', 'encrypted'])
		expect(mod).toHaveProperty('encryptedField')
	})

	it('rejects with a module-not-found error for a package that is not installed', async () => {
		const failure = await importPeer(['@10x-media', 'no-such-peer']).catch((err: unknown) => err)
		expect(isModuleNotFoundError(failure)).toBe(true)
	})

	it('hands bundlers a specifier they cannot analyze, with every ignore comment', () => {
		const text = readFileSync(join(SRC, 'plugin/peers.ts'), 'utf8')
		expect(text).toContain("const specifier = parts.join('/')")
		expect(text).toContain(
			'import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ specifier)'
		)
	})

	it('spots a literal peer import the way a bundler would', () => {
		expect(
			runtimeSpecifiers(
				[
					"import type { Reader } from 'maxmind'",
					"import { open } from 'maxmind'",
					"export { sql } from '@payloadcms/db-postgres'",
					"type Mod = typeof import('@google-analytics/data')",
					"const mod = await import('@10x-media/fields/encrypted')",
				].join('\n')
			)
		).toEqual(['maxmind', '@payloadcms/db-postgres', '@10x-media/fields/encrypted'])
	})

	it('is the only way any source file loads an optional peer', () => {
		expect(sourceFiles().length).toBeGreaterThan(100)
		const offenders = sourceFiles().flatMap((file) =>
			runtimeSpecifiers(readFileSync(join(SRC, file), 'utf8'))
				.filter((specifier) => OPTIONAL_PEER.test(specifier))
				.map((specifier) => `${file}: ${specifier}`)
		)
		expect(offenders).toEqual([])
	})

	it('loads the required @10x-media/fields by a literal specifier, which file tracing follows', () => {
		const importers = sourceFiles().filter((file) =>
			runtimeSpecifiers(readFileSync(join(SRC, file), 'utf8')).includes(
				'@10x-media/fields/encrypted'
			)
		)
		expect(importers).toEqual([join('plugin', 'encrypted.ts')])
	})
})

describe('peer loaders', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('loads the encrypted field helpers', async () => {
		const mod = await loadEncrypted()
		expect(typeof mod.encryptedField).toBe('function')
		expect(typeof mod.withRawEncrypted).toBe('function')
	})

	it('loads the MaxMind reader and the GA4 client when nothing was passed in', async () => {
		expect(typeof (await loadMaxmind()).open).toBe('function')
		expect(typeof (await loadGa4()).BetaAnalyticsDataClient).toBe('function')
	})

	it('names sdks and the file tracing that missed the package when it cannot load', async () => {
		await expect(loadGa4(['@google-analytics', 'no-such-sdk'])).rejects.toThrow(
			/^analytics: peer "@google-analytics\/data" could not be loaded.*sdks: \{ ga4: \{ BetaAnalyticsDataClient \} \}.*standalone and serverless builds/
		)
		await expect(loadMaxmind(['no-such-maxmind'])).rejects.toThrow(
			/^analytics: peer "maxmind" could not be loaded.*sdks: \{ maxmind: \{ open \} \}.*standalone and serverless builds/
		)
	})

	it('words each production warning as the fix, import line included', () => {
		expect(GA4_SDK_WARNING).toMatch(/^analytics: peer "@google-analytics\/data" /)
		expect(MAXMIND_SDK_WARNING).toMatch(/^analytics: peer "maxmind" /)
		expect(GA4_SDK_WARNING).toContain(
			"import { BetaAnalyticsDataClient } from '@google-analytics/data', then sdks: { ga4: { BetaAnalyticsDataClient } }"
		)
		expect(MAXMIND_SDK_WARNING).toContain(
			"import { open } from 'maxmind', then sdks: { maxmind: { open } }"
		)
	})

	it('tells a production build from any other', () => {
		vi.stubEnv('NODE_ENV', 'production')
		expect(isProductionBuild()).toBe(true)
		vi.stubEnv('NODE_ENV', 'development')
		expect(isProductionBuild()).toBe(false)
	})

	// `next build` runs with NODE_ENV production and boots Payload in each page-data worker.
	it('is no production build while next build collects page data', () => {
		vi.stubEnv('NODE_ENV', 'production')
		vi.stubEnv('NEXT_PHASE', 'phase-production-build')
		try {
			expect(isProductionBuild()).toBe(false)
		} finally {
			vi.unstubAllEnvs()
		}
	})
})
