import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
	readForField,
	readForWidget,
	readForWidgetBreakdown,
	readForWidgetGoals,
	readForWidgetRealtime,
	readForWidgetSeries,
	SYSTEM,
} from '../index'
import * as rsc from './rsc'

const SRC = fileURLToPath(new URL('..', import.meta.url))

/** Packages a module may not load where Payload's CLI or a plain worker imports the plugin. */
const UI_PACKAGE = /^(react|react-dom|@payloadcms\/ui|@payloadcms\/next|next)(\/|$)/

const STYLESHEET = /\.(s?css|sass)$/

/** True for `{ type A, type B }`: a clause TypeScript erases along with the import. */
const typeOnlyClause = (clause: string): boolean => {
	const braces = clause.match(/^\s*\{([\s\S]*)\}\s*$/)
	if (!braces?.[1]) {
		return false
	}
	const names = braces[1]
		.split(',')
		.map((name) => name.trim())
		.filter((name) => name !== '')
	return names.length > 0 && names.every((name) => name.startsWith('type '))
}

/**
 * Every module a file loads at runtime: value imports and re-exports, side-effect imports, and
 * `import()` unless `dynamic` is false.
 */
const runtimeSpecifiers = (text: string, dynamic = true): string[] => {
	const found: string[] = []
	for (const match of text.matchAll(
		/^\s*(?:import|export)\s+(?!type\b)([^'"`;]*?)\s+from\s+['"]([^'"]+)['"]/gm
	)) {
		const [, clause = '', specifier = ''] = match
		if (!typeOnlyClause(clause)) {
			found.push(specifier)
		}
	}
	for (const match of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
		if (match[1]) found.push(match[1])
	}
	for (const match of dynamic
		? text.matchAll(/(?<!typeof\s*)\bimport\(\s*['"]([^'"]+)['"]/g)
		: []) {
		if (match[1]) found.push(match[1])
	}
	return found
}

const resolveLocal = (from: string, specifier: string): string | undefined => {
	const base = resolve(dirname(from), specifier)
	return [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), base].find(
		(candidate) => existsSync(candidate) && /\.tsx?$/.test(candidate)
	)
}

/** Each module the entry reaches at runtime, and what reaches it, walked over relative imports. */
const reachableFrom = (
	entry: string,
	dynamic = true
): { modules: Set<string>; packages: Map<string, string> } => {
	const modules = new Set<string>()
	const packages = new Map<string, string>()
	const pending = [entry]
	while (pending.length > 0) {
		const file = pending.pop()
		if (!file || modules.has(file)) {
			continue
		}
		modules.add(file)
		for (const specifier of runtimeSpecifiers(readFileSync(file, 'utf8'), dynamic)) {
			if (!specifier.startsWith('.')) {
				packages.set(specifier, relative(SRC, file))
				continue
			}
			const local = resolveLocal(file, specifier)
			if (local) {
				pending.push(local)
			} else if (STYLESHEET.test(specifier)) {
				packages.set(specifier, relative(SRC, file))
			}
		}
	}
	return { modules, packages }
}

describe('the root entry', () => {
	it('spots a value import and skips one TypeScript erases', () => {
		expect(
			runtimeSpecifiers(
				[
					"import type { ReactNode } from 'react'",
					"import { type FC } from 'react'",
					"import { useState, type FC } from 'react'",
					"export { formatAdminURL } from 'payload/shared'",
					"import './styles.css'",
				].join('\n')
			)
		).toEqual(['react', 'payload/shared', './styles.css'])
	})

	it('loads no React, no admin UI and no stylesheet, so the CLI and a worker can import it', () => {
		const { modules, packages } = reachableFrom(join(SRC, 'index.ts'))
		expect(modules.size).toBeGreaterThan(50)
		const offenders = [...packages]
			.filter(([specifier]) => UI_PACKAGE.test(specifier) || STYLESHEET.test(specifier))
			.map(([specifier, file]) => `${file}: ${specifier}`)
		const components = [...modules]
			.filter((file) => file.endsWith('.tsx'))
			.map((file) => relative(SRC, file))
		// Imported only inside a process Next serves requests in, where it is already loaded.
		expect(offenders).toEqual(['plugin/keepAlive.ts: next/server'])
		expect(components).toEqual([])
		const statically = reachableFrom(join(SRC, 'index.ts'), false)
		expect(
			[...statically.packages.keys()].filter((specifier) => UI_PACKAGE.test(specifier))
		).toEqual([])
	})

	it('keeps /migrations as light, since a migration file imports it under the CLI', () => {
		const { packages } = reachableFrom(join(SRC, 'exports', 'migrations.ts'))
		expect(
			[...packages.keys()].filter(
				(specifier) => UI_PACKAGE.test(specifier) || STYLESHEET.test(specifier)
			)
		).toEqual([])
	})

	it('keeps Payload out of what /next loads up front, so a next.config can import it', () => {
		const statically = reachableFrom(join(SRC, 'exports', 'next.ts'), false)
		expect(
			[...statically.packages.keys()].filter((specifier) => /^payload(\/|$)/.test(specifier))
		).toEqual([])
		const lazily = reachableFrom(join(SRC, 'exports', 'next.ts'))
		expect([...lazily.packages.keys()]).toContain('payload')
	})

	it('is walked deeply enough to see what /rsc loads', () => {
		const { modules, packages } = reachableFrom(join(SRC, 'exports', 'rsc.ts'))
		expect([...packages.keys()].some((specifier) => UI_PACKAGE.test(specifier))).toBe(true)
		expect([...modules].some((file) => file.endsWith('.tsx'))).toBe(true)
	})

	it('serves the server reads and the system principal that /rsc also exports', () => {
		expect(readForField).toBe(rsc.readForField)
		expect(readForWidget).toBe(rsc.readForWidget)
		expect(readForWidgetBreakdown).toBe(rsc.readForWidgetBreakdown)
		expect(readForWidgetGoals).toBe(rsc.readForWidgetGoals)
		expect(readForWidgetRealtime).toBe(rsc.readForWidgetRealtime)
		expect(readForWidgetSeries).toBe(rsc.readForWidgetSeries)
		expect(typeof readForWidget).toBe('function')
		expect(SYSTEM).toBe(rsc.SYSTEM)
		expect(SYSTEM).toBe(Symbol.for('@10x-media/analytics/system'))
	})
})
