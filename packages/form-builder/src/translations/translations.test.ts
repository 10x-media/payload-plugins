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

const KEYS_FILE = join(packageRoot, 'src/translations/keys.ts')

/**
 * Marks a locale table, which enumerates every key by definition and so can never count as usage.
 * Matched on the `Record<TranslationKey, string>` annotation that already keeps locales in lockstep
 * rather than on a filename list: a list silently blinds this scan the day a locale is left off it.
 */
const LOCALE_TABLE_ANNOTATION = /:\s*Record<\s*TranslationKey\s*,\s*string\s*>/

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
		if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
			out.push(full)
		}
	}
	return out
}

/** Production files a key must be referenced from to count as used. */
const usageFiles = (): string[] =>
	[
		...collectSourceFiles(join(packageRoot, 'src')),
		...collectSourceFiles(join(packageRoot, 'registry', 'form-builder')),
	].filter(
		(file) => file !== KEYS_FILE && !LOCALE_TABLE_ANNOTATION.test(readFileSync(file, 'utf8'))
	)

/** The subset of `names` no production file references as `keys.<name>`. */
const unusedKeyNames = (names: string[]): string[] => {
	const combined = usageFiles()
		.map((file) => readFileSync(file, 'utf8'))
		.join('\n')
	return names.filter((name) => !new RegExp(`\\bkeys\\.${name}\\b`).test(combined))
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
		expect(unusedKeyNames(Object.keys(keys))).toEqual([])
	})

	it('scans a non-empty corpus that excludes every key-enumerating file', () => {
		const scanned = usageFiles()
		expect(scanned.length).toBeGreaterThan(0)
		expect(scanned).not.toContain(KEYS_FILE)
		for (const file of scanned) {
			expect(LOCALE_TABLE_ANNOTATION.test(readFileSync(file, 'utf8'))).toBe(false)
		}
	})

	it('reports a key that production code never references', () => {
		expect(unusedKeyNames(['keyNoProductionFileMentions'])).toEqual(['keyNoProductionFileMentions'])
	})
})
