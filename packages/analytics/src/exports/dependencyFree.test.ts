import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('..', import.meta.url))

const STYLESHEET = /\.(s?css|sass)$/

/** Every module a source names: value and type imports, re-exports, `import()` and `import('x')` types. */
const specifiersOf = (text: string): string[] =>
	ts.preProcessFile(text, true, true).importedFiles.map((ref) => ref.fileName)

const resolveLocal = (from: string, specifier: string): string | undefined => {
	const base = resolve(dirname(from), specifier)
	return [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find(
		(candidate) => existsSync(candidate) && statSync(candidate).isFile()
	)
}

/**
 * What an entry reaches through its declarations as well as its code: every module, walked over
 * relative imports, and every package or stylesheet one of them names.
 */
const reachableFrom = (entry: string): { modules: string[]; external: Map<string, string> } => {
	const modules = new Set<string>()
	const external = new Map<string, string>()
	const pending = [join(SRC, entry)]
	while (pending.length > 0) {
		const file = pending.pop()
		if (!file || modules.has(file)) {
			continue
		}
		modules.add(file)
		for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
			const local = specifier.startsWith('.') ? resolveLocal(file, specifier) : undefined
			if (local) {
				pending.push(local)
			} else if (!external.has(specifier)) {
				external.set(specifier, relative(SRC, file))
			}
		}
	}
	return { modules: [...modules].map((file) => relative(SRC, file)).sort(), external }
}

const named = (external: Map<string, string>): string[] =>
	[...external].map(([specifier, file]) => `${file}: ${specifier}`).sort()

describe('the import graph walk', () => {
	it('sees type-only imports, type re-exports and import types beside value imports', () => {
		expect(
			specifiersOf(
				[
					"import type { Payload } from 'payload'",
					"import { type FC, useState } from 'react'",
					"export type * from './contract'",
					"export type { X } from './x'",
					"type Sdk = typeof import('maxmind')",
					"import './styles.css'",
				].join('\n')
			)
		).toEqual(['payload', 'react', './contract', './x', 'maxmind', './styles.css'])
	})
})

describe('entries a browser or any runtime loads', () => {
	it('/tracker names no package and no stylesheet, through types included', () => {
		const { modules, external } = reachableFrom('exports/tracker.ts')
		expect(modules).toContain('tracker/createTracker.ts')
		expect(named(external)).toEqual([])
	})

	it('/attributes names no package and no stylesheet', () => {
		const { modules, external } = reachableFrom('exports/attributes.ts')
		expect(modules).toContain('goals/constants.ts')
		expect(named(external)).toEqual([])
	})

	it('/react names React alone', () => {
		const { external } = reachableFrom('exports/react.ts')
		expect([...external.keys()].sort()).toEqual(['react'])
	})

	it('/site names React and Payload alone, and reaches no admin module', () => {
		const { modules, external } = reachableFrom('exports/site.ts')
		const allowed = new Set(['payload', 'payload/shared', 'react', 'react/jsx-runtime'])
		expect(named(external).filter((line) => !allowed.has(line.split(': ')[1] ?? ''))).toEqual([])
		expect([...external.keys()].filter((specifier) => STYLESHEET.test(specifier))).toEqual([])
		expect(modules.filter((file) => /^(view|widgets|fields|charts|ui)\//.test(file))).toEqual([])
	})
})
