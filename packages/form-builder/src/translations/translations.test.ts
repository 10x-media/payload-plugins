import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { de } from './de'
import { en } from './en'
import { translations } from './index'
import { keys } from './keys'

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo'])

/** Files that enumerate every key by definition; they don't count as "usage". */
const SELF_DEFINING_FILES = new Set([
	join(packageRoot, 'src/translations/keys.ts'),
	join(packageRoot, 'src/translations/en.ts'),
])

const collectSourceFiles = (dir: string, out: string[] = []): string[] => {
	for (const entry of readdirSync(dir)) {
		if (SKIP_DIRS.has(entry)) {
			continue
		}
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) {
			collectSourceFiles(full, out)
			continue
		}
		if (
			/\.(ts|tsx)$/.test(entry) &&
			!entry.endsWith('.test.ts') &&
			!entry.endsWith('.test.tsx') &&
			!SELF_DEFINING_FILES.has(full)
		) {
			out.push(full)
		}
	}
	return out
}

describe('form-builder translations', () => {
	it('exposes the fieldTitle key', () => {
		expect(keys.fieldTitle).toBe('formBuilder:fieldTitle')
	})

	it('has an en string for every key', () => {
		for (const key of Object.values(keys)) {
			expect(typeof en[key]).toBe('string')
		}
	})

	it('has a non-empty de string for every key', () => {
		for (const key of Object.values(keys)) {
			expect(typeof de[key]).toBe('string')
			expect(de[key].length).toBeGreaterThan(0)
		}
	})

	it('preserves every {token} from en in the matching de string', () => {
		const tokenPattern = /\{(\w+)\}/g
		for (const key of Object.values(keys)) {
			const enTokens = [...en[key].matchAll(tokenPattern)].map((match) => match[1]).sort()
			const deTokens = [...de[key].matchAll(tokenPattern)].map((match) => match[1]).sort()
			expect(deTokens).toEqual(enTokens)
		}
	})

	it('nests strings under the formBuilder namespace', () => {
		expect(translations.en.formBuilder).toBeDefined()
		expect(translations.de.formBuilder).toBeDefined()
	})

	it('references every translation key from production code', () => {
		const files = [
			...collectSourceFiles(join(packageRoot, 'src')),
			...collectSourceFiles(join(packageRoot, 'registry', 'form-builder')),
		]
		const combined = files.map((file) => readFileSync(file, 'utf8')).join('\n')

		const unused = Object.keys(keys).filter(
			(name) => !new RegExp(`\\bkeys\\.${name}\\b`).test(combined)
		)
		expect(unused).toEqual([])
	})
})
