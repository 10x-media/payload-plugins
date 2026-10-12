import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { MigrationTemplateArgs } from 'payload'
import { describe, expect, it } from 'vitest'
import * as helpers from '../../exports/migrations'
import * as template from './dropLegacyMongo'

const packageJson: unknown = JSON.parse(
	readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')
)

/** One entry of the manifest's exports map, or of the map `publishConfig` swaps in. */
const exportEntry = (publish: boolean, subpath: string): unknown => {
	const root = publish ? Reflect.get(Object(packageJson), 'publishConfig') : packageJson
	return Reflect.get(Object(Reflect.get(Object(root), 'exports')), subpath)
}

describe('the drop-legacy-mongo predefined migration', () => {
	it('is the shape getPredefinedMigration reads', () => {
		const args: MigrationTemplateArgs = template
		expect(Object.keys(args).sort()).toEqual(['downSQL', 'imports', 'upSQL'])
	})

	it('imports a helper the migrations entry exports and calls it with payload', () => {
		const match = template.imports.match(/^import \{ (\w+) \} from '([^']+)'$/)
		expect(match?.[2]).toBe('@10x-media/analytics/migrations')
		const name = match?.[1] ?? ''
		expect(typeof Reflect.get(helpers, name)).toBe('function')
		expect(template.upSQL.trim()).toBe(`await ${name}({ payload })`)
	})

	it('undoes nothing', () => {
		expect(template.downSQL.trim()).toMatch(/^\/\/ /)
		expect(template.downSQL).not.toContain('\n')
	})

	it('resolves from the package by its subpath, in development and once published', () => {
		expect(exportEntry(false, './migrations/drop-legacy-mongo')).toEqual({
			development: './src/migrations/predefined/dropLegacyMongo.ts',
			types: './src/migrations/predefined/dropLegacyMongo.ts',
			default: './dist/migrations/predefined/dropLegacyMongo.js',
		})
		expect(exportEntry(true, './migrations/drop-legacy-mongo')).toEqual({
			types: './dist/migrations/predefined/dropLegacyMongo.d.ts',
			import: './dist/migrations/predefined/dropLegacyMongo.js',
			default: './dist/migrations/predefined/dropLegacyMongo.js',
		})
		expect(exportEntry(true, './migrations')).toEqual({
			types: './dist/exports/migrations.d.ts',
			import: './dist/exports/migrations.js',
			default: './dist/exports/migrations.js',
		})
	})
})
