import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	collectExternals,
	collectStaticFiles,
	distDir,
	hasDist,
	staticImportsOf,
} from './importGraph'

const METADATA_SETS = ['max', 'min', 'mobile'] as const
const METADATA_PREFIX = 'libphonenumber-js/metadata'
const FLAG_ARTWORK = 'country-flag-icons'
const METADATA_MODULE = join(distDir, 'fields/phoneNumber/engine/metadata.js')

/** Every entry an install can reach the phone family through. */
const ENTRIES = [
	'index.js',
	'exports/phone.js',
	'exports/phone-utils.js',
	'exports/client.js',
	'exports/rsc.js',
]

describe.skipIf(!hasDist)('phone dist import graph', () => {
	it('the loader module is emitted', () => {
		expect(existsSync(METADATA_MODULE)).toBe(true)
	})

	// The walk skips a specifier it cannot resolve, so a truncated graph would satisfy every
	// "never statically reaches" assertion below without having traversed anything at all.
	it.each(ENTRIES)('%s really traverses the phone family', (entry) => {
		const files = collectStaticFiles(join(distDir, entry))
		expect(files.has(METADATA_MODULE), `${entry} reaches no phone module at all`).toBe(true)
	})
})

describe.skipIf(!hasDist)('phone metadata dist laziness', () => {
	// Guards the dynamic-only assertion below from passing vacuously: if the loaders stopped
	// naming the metadata sets at all, no entry could statically reach them either.
	it.each(METADATA_SETS)('loads the %s set through a dynamic import', (set) => {
		const source = readFileSync(METADATA_MODULE, 'utf8')
		expect(source).toContain(`import("${METADATA_PREFIX}.${set}.json")`)
		expect(staticImportsOf(source).some((s) => s.startsWith(METADATA_PREFIX))).toBe(false)
	})

	it.each(ENTRIES)('%s never statically reaches the metadata sets', (entry) => {
		const offenders = [...collectExternals(join(distDir, entry))].filter((specifier) =>
			specifier.startsWith(METADATA_PREFIX)
		)
		expect(offenders, `${entry} statically imports metadata`).toEqual([])
	})

	// The parser core is ~20 kB and every entry needs it synchronously; only the metadata
	// (145 kB for the max set) is lazy. Pins the split so the assertion above stays meaningful.
	it('still reaches the parser core statically', () => {
		const externals = collectExternals(join(distDir, 'exports/phone.js'))
		expect([...externals]).toContain('libphonenumber-js/core')
	})
})

describe.skipIf(!hasDist)('phone flag artwork dist laziness', () => {
	// The ~266-module country-flag-icons barrel must stay behind the dynamic import in
	// flagsEndpoint.ts. index.js is the entry that reaches the handler, while the admin
	// entries reach CountryFlag instead, which builds a URL for the route rather than
	// importing artwork: a static import added there would miss a gate on index.js alone.
	it.each(ENTRIES)('%s never statically reaches country-flag-icons', (entry) => {
		const offenders = [...collectExternals(join(distDir, entry))].filter((specifier) =>
			specifier.startsWith(FLAG_ARTWORK)
		)
		expect(offenders, `${entry} statically imports flag artwork`).toEqual([])
	})

	it('still reaches the flag route handler statically', () => {
		const files = collectStaticFiles(join(distDir, 'index.js'))
		expect(files.has(join(distDir, 'fields/phoneNumber/server/flagsEndpoint.js'))).toBe(true)
	})

	it('the admin entries still reach the flag component statically', () => {
		for (const entry of ['exports/client.js', 'exports/rsc.js']) {
			const files = collectStaticFiles(join(distDir, entry))
			expect(
				files.has(join(distDir, 'fields/phoneNumber/client/CountryFlag.js')),
				`${entry} reaches no flag component`
			).toBe(true)
		}
	})
})
