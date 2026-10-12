import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _internal_jobSystemGlobals, _internal_resetJobSystemGlobals } from 'payload'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { currentDate, currentTime } from './clock'

const SRC = fileURLToPath(new URL('..', import.meta.url))

/** The only clock reads besides `core/clock.ts`, each with why it reads a clock of its own. */
const OWN_CLOCKS: Readonly<Record<string, string>> = {
	'ui/viewerClock.ts':
		"the viewer's clock: Payload's runs on the server, out of the browser's reach",
	'adapters/readTime.ts':
		"an adapter read outside the engine is handed no clock, so it is stamped by the real one; the engine's reads are stamped by Payload's",
	'adapters/http/fetchJson.ts':
		"Retry-After's HTTP date is the vendor's, stamped in real time, so the real clock measures it",
}

const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			return entry.name === '__golden__' ? [] : sourceFiles(path)
		}
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
	})

/** Every `new Date()` with no argument, `Date.now` and `getCurrentDate` in one file's code. */
const clockReads = (file: string): string[] => {
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true)
	const found: string[] = []
	const visit = (node: ts.Node): void => {
		const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
		if (
			ts.isNewExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'Date' &&
			(node.arguments?.length ?? 0) === 0
		) {
			found.push(`new Date() at line ${line}`)
		}
		if (
			ts.isPropertyAccessExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'Date' &&
			node.name.text === 'now'
		) {
			found.push(`Date.now at line ${line}`)
		}
		if (ts.isIdentifier(node) && node.text === 'getCurrentDate') {
			found.push(`getCurrentDate at line ${line}`)
		}
		ts.forEachChild(node, visit)
	}
	visit(source)
	return found
}

describe('the one clock', () => {
	afterEach(() => {
		_internal_resetJobSystemGlobals()
	})

	it('is the clock Payload sets for its jobs, which a test can stop', () => {
		const stopped = new Date('2026-01-15T12:00:00.000Z')
		_internal_jobSystemGlobals.getCurrentDate = () => new Date(stopped.getTime())
		expect(currentDate().toISOString()).toBe(stopped.toISOString())
		expect(currentTime()).toBe(stopped.getTime())
	})

	// What time it is comes from `core/clock` on the server and `ui/viewerClock` in the browser;
	// everything that times a duration reads `core/monotonic`.
	it('is the only clock source code reads, its own files and the reasons listed aside', () => {
		const reads: string[] = []
		for (const file of sourceFiles(SRC)) {
			const path = relative(SRC, file)
			if (path === 'core/clock.ts' || OWN_CLOCKS[path] !== undefined) {
				continue
			}
			for (const read of clockReads(file)) {
				reads.push(`${path}: ${read}`)
			}
		}
		expect(reads).toEqual([])
	})

	it('still finds the reads it lists aside, so no reason outlives its read', () => {
		for (const path of Object.keys(OWN_CLOCKS)) {
			expect(clockReads(join(SRC, path)).length, path).toBeGreaterThan(0)
		}
	})
})
