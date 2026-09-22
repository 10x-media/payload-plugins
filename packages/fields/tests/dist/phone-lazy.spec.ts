import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectExternals, distDir, hasDist, staticImportsOf } from './importGraph'

const METADATA_SETS = ['max', 'min', 'mobile'] as const
const METADATA_PREFIX = 'libphonenumber-js/metadata'
const METADATA_MODULE = join(distDir, 'fields/phoneNumber/engine/metadata.js')

/** Every entry an install can reach the phone family through. */
const ENTRIES = [
	'index.js',
	'exports/phone.js',
	'exports/phone-utils.js',
	'exports/client.js',
	'exports/rsc.js',
]

describe.skipIf(!hasDist)('phone metadata dist laziness', () => {
	it('the loader module is emitted', () => {
		expect(existsSync(METADATA_MODULE)).toBe(true)
	})

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
