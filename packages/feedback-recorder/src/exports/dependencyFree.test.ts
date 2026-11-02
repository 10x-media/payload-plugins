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

describe('the recorder entry', () => {
	it('/recorder reaches React and tus alone: no Payload, no Next, no stylesheet', () => {
		const { modules, external } = reachableFrom('exports/recorder.ts')
		expect(modules).toContain('recorder/useClipRecorder.ts')
		expect([...external.keys()].sort()).toEqual(['react', 'tus-js-client'])
		expect([...external.keys()].filter((specifier) => STYLESHEET.test(specifier))).toEqual([])
	})
})
