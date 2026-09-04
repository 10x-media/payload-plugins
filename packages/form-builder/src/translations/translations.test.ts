import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ar } from './ar'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { id } from './id'
import { bundles, translations } from './index'
import { keys } from './keys'
import { ko } from './ko'
import { pt } from './pt'
import { ru } from './ru'
import { uk } from './uk'
import { zh } from './zh'

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/** Every shipped locale but `en`, the table the others are checked against. */
const locales = Object.entries({ ar, de, es, fr, id, ko, pt, ru, uk, zh })

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo'])

/**
 * Excluded from the usage corpus wholesale, by directory rather than by naming the files in it.
 *
 * Every locale table here enumerates every key by construction, so letting a single one into the
 * corpus makes this whole scan vacuous: it matches all 220 keys on its own and nothing is ever
 * reported unused. Recognizing tables by name, or by their `Record<TranslationKey, string>`
 * annotation, both leave that trapdoor open: a locale added under a different name, or written as
 * `satisfies Record<...>`, `Readonly<Record<...>>`, or via a shared alias, quietly rejoins the
 * corpus and re-blinds the scan with no test able to notice. Excluding the directory has no such
 * mode. Nothing is lost: no file here consumes a `keys.X` reference (`server.ts`,
 * `useTranslation.ts`, `makeTranslate.ts`, and `index.ts` all take keys as parameters), so a key
 * used only from this directory is not a used key. Do not narrow this back to a file list.
 */
const TRANSLATIONS_DIR = join(packageRoot, 'src/translations')

/**
 * Whether `file` sits anywhere inside `TRANSLATIONS_DIR`, not just as a direct child. A locale
 * table nested in a subdirectory (e.g. `src/translations/locales/fr.ts`) must stay excluded too;
 * a same-directory check alone would let it rejoin the corpus and re-blind the scan. `relative`
 * (rather than a string prefix) stays correct across platforms and doesn't false-positive on a
 * sibling directory that merely shares the name as a prefix (`translations-extra/`).
 */
const isUnderTranslationsDir = (file: string): boolean => {
	const rel = relative(TRANSLATIONS_DIR, file)
	return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

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
	].filter((file) => !isUnderTranslationsDir(file))

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

	it.each(locales)('has a non-empty %s string for every key', (_locale, table) => {
		for (const key of Object.values(keys)) {
			expect(typeof table[key]).toBe('string')
			expect(table[key].length).toBeGreaterThan(0)
		}
	})

	it.each(locales)('preserves every {token} from en in the %s string', (_locale, table) => {
		const tokenPattern = /\{(\w+)\}/g
		for (const key of Object.values(keys)) {
			const enTokens = [...en[key].matchAll(tokenPattern)].map((match) => match[1]).sort()
			const tokens = [...table[key].matchAll(tokenPattern)].map((match) => match[1]).sort()
			expect(tokens).toEqual(enTokens)
		}
	})

	it('nests strings under the formBuilder namespace', () => {
		expect(translations.en?.formBuilder).toBeDefined()
		for (const [locale] of locales) {
			expect(translations[locale]?.formBuilder).toBeDefined()
		}
	})

	it('ships a complete bundle for every registered locale (a host fallback cannot leak a key)', () => {
		const allKeys = Object.values(keys)
		expect(Object.keys(bundles).length).toBeGreaterThan(0)
		for (const [locale, bundle] of Object.entries(bundles)) {
			for (const key of allKeys) {
				expect(typeof bundle[key], `${locale} missing ${key}`).toBe('string')
			}
		}
	})

	it('references every translation key from production code', () => {
		expect(unusedKeyNames(Object.keys(keys))).toEqual([])
	})

	it('scans a non-empty corpus holding no file from the translations directory', () => {
		const scanned = usageFiles()
		expect(scanned.length).toBeGreaterThan(0)
		expect(scanned.filter(isUnderTranslationsDir)).toEqual([])
		expect(scanned).toContain(join(packageRoot, 'src/index.ts'))
	})

	it('reports a key that production code never references', () => {
		expect(unusedKeyNames(['keyNoProductionFileMentions'])).toEqual(['keyNoProductionFileMentions'])
	})

	it('excludes a locale table nested in a subdirectory, not only direct children', () => {
		expect(isUnderTranslationsDir(join(TRANSLATIONS_DIR, 'locales', 'fr.ts'))).toBe(true)
	})

	it('does not exclude a sibling directory whose name merely starts with translations', () => {
		expect(
			isUnderTranslationsDir(join(dirname(TRANSLATIONS_DIR), 'translations-extra', 'fr.ts'))
		).toBe(false)
	})

	// The corpus is only a real check if a locale table entering it would break the scan. Proves the
	// vacuum the directory exclusion exists to prevent, without depending on how a table is written.
	it('would be made vacuous by a single locale table in the corpus', () => {
		const deTable = readFileSync(join(TRANSLATIONS_DIR, 'de.ts'), 'utf8')
		const unusedAgainstTableAlone = Object.keys(keys).filter(
			(name) => !new RegExp(`\\bkeys\\.${name}\\b`).test(deTable)
		)
		expect(unusedAgainstTableAlone).toEqual([])
	})
})
