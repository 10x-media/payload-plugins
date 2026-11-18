/**
 * Post-build dist verification for published packages. Guards the invariants
 * the per-file build relies on, so a config regression cannot silently ship a
 * broken or bloated package again:
 *
 * 1. No `dist/node_modules`: a dependency imported at runtime but only
 *    declared as a devDependency gets inlined into dist instead of staying
 *    external. Declare it as a dependency or (optional) peerDependency.
 * 2. Directive parity: every `src` module carrying 'use client' / 'use server'
 *    must exist in dist with the directive as its first line, otherwise
 *    Next.js loses the RSC boundary and admin components crash at runtime.
 * 3. No undirected hook callers: any dist file calling a client-only React hook must
 *    start with 'use client'.
 * 4. Every package.json `exports` target must exist on disk.
 * 5. publint must report no errors.
 * 6. Every relative `.css` import a dist module keeps must resolve inside dist: the build
 *    leaves stylesheet imports in place, so a stylesheet missing from the build's `copy`
 *    breaks the consumer's bundle. A package whose dist imports stylesheets while
 *    `sideEffects` is `false` gets a warning, since a production bundler may drop them.
 *
 * 7. Browser-safe graphs: nothing reachable from a 'use client' module or from a `./shared`
 *    entry imports a `node:*` builtin or a value from `payload` that `payload/shared` lacks.
 *    Payload 4 maps the `browser` condition to `payload/shared`, so a client bundle that reaches
 *    `definePlugin` or `createPayloadRequest` fails to build. A `./shared` entry must also stay
 *    clear of 'use client' modules, since a server caller would get a client reference instead
 *    of the function.
 *
 * Run standalone via `pnpm check:dist` (after a build) or in CI. Pass `--only-built` to
 * skip packages that have no `dist/` at all, which is what an affected-scoped CI build
 * leaves behind: the packages outside the run's scope were never built, and reporting
 * them as failures would defeat the scoping.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { publint } from 'publint'
import { formatMessage } from 'publint/utils'

const REPO_ROOT = process.cwd()
const PACKAGES_DIR = join(REPO_ROOT, 'packages')

const DIRECTIVE_RE = /^(['"])use (client|server)\1/
// useId, useMemo and useCallback are left out: React's server build exports them, so a server
// component may call them.
const HOOK_CALL_RE =
	/\buse(State|Ref|Effect|LayoutEffect|Transition|Reducer|Context|SyncExternalStore)\(/
const CSS_IMPORT_RE = /^\s*import\s+['"]([^'"]+\.css)['"];?\s*$/gm

const walk = (dir: string, matches: (path: string) => boolean): string[] => {
	if (!existsSync(dir)) return []
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name)
		if (statSync(path).isDirectory()) return walk(path, matches)
		return matches(path) ? [path] : []
	})
}

const firstLine = (path: string): string =>
	readFileSync(path, 'utf8').trimStart().split('\n', 1)[0] ?? ''

const exportTargets = (exports: unknown): string[] => {
	if (typeof exports === 'string') return [exports]
	if (exports && typeof exports === 'object') return Object.values(exports).flatMap(exportTargets)
	return []
}

const IMPORT_RE =
	/(?:^|\n)\s*(?:import|export)\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
const EXPORT_NAMES_RE = /export\s*\{([^}]*)\}/g
const EXPORT_STAR_RE = /export\s*\*\s*from\s*['"]([^'"]+)['"]/g
const EXPORT_DECL_RE = /export\s+(?:async\s+)?(?:const|function|class|let)\s+(\w+)/g

/** Value names `payload/shared` exports, read from the build the package resolves. */
const payloadSharedNames = (pkgDir: string): Set<string> | null => {
	let entry: string
	try {
		entry = createRequire(join(pkgDir, 'package.json')).resolve('payload/shared')
	} catch {
		return null
	}
	const names = new Set<string>()
	const text = readFileSync(entry, 'utf8')
	for (const [, list = ''] of text.matchAll(EXPORT_NAMES_RE)) {
		for (const part of list.split(',')) {
			const name = part
				.trim()
				.split(/\s+as\s+/)
				.pop()
			if (name) names.add(name)
		}
	}
	for (const [, specifier = ''] of text.matchAll(EXPORT_STAR_RE)) {
		const target = join(dirname(entry), specifier)
		if (!existsSync(target)) continue
		for (const [, name = ''] of readFileSync(target, 'utf8').matchAll(EXPORT_DECL_RE)) {
			names.add(name)
		}
	}
	return names
}

type ModuleFacts = { bad: string[]; client: boolean; deps: string[] }

/**
 * Follows the relative imports of every 'use client' module and every `./shared` entry in a
 * package's dist, and reports what a browser build cannot load.
 */
const verifyBrowserGraphs = (
	pkgDir: string,
	distDir: string,
	sharedEntries: string[]
): string[] => {
	const shared = payloadSharedNames(pkgDir)
	if (!shared) return []
	const facts = new Map<string, ModuleFacts>()
	const factsOf = (file: string): ModuleFacts => {
		const known = facts.get(file)
		if (known) return known
		const text = readFileSync(file, 'utf8')
		const bad: string[] = []
		const deps: string[] = []
		for (const [, clause = '', from, bare] of text.matchAll(IMPORT_RE)) {
			const specifier = from ?? bare ?? ''
			if (specifier === 'payload') {
				if (/^type\s/.test(clause)) continue
				if (/\*\s+as\s/.test(clause)) bad.push('payload (namespace import)')
				const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? ''
				for (const part of named.split(',')) {
					const name = part.trim().split(/\s+as\s+/)[0]
					if (name && !name.startsWith('type ') && !shared.has(name)) bad.push(`payload#${name}`)
				}
			} else if (specifier.startsWith('node:')) {
				bad.push(specifier)
			} else if (specifier.startsWith('.')) {
				const target = join(dirname(file), specifier)
				if (existsSync(target)) deps.push(target)
			}
		}
		const result = { bad, client: DIRECTIVE_RE.test(text.trimStart()), deps }
		facts.set(file, result)
		return result
	}
	const errors: string[] = []
	const reported = new Set<string>()
	const walkFrom = (start: string, label: string, refuseClient: boolean): void => {
		const parent = new Map<string, string | null>([[start, null]])
		const queue = [start]
		while (queue.length > 0) {
			const current = queue.shift() as string
			const { bad, client, deps } = factsOf(current)
			const problems = refuseClient && client && current !== start ? ["a 'use client' module"] : bad
			if (problems.length > 0) {
				if (reported.has(current)) continue
				reported.add(current)
				const chain: string[] = []
				for (let at: string | null | undefined = current; at; at = parent.get(at)) {
					chain.unshift(relative(distDir, at).replaceAll('\\', '/'))
				}
				errors.push(`${label} reaches ${problems.join(', ')}: ${chain.join(' -> ')}`)
				continue
			}
			for (const dep of deps) {
				if (parent.has(dep)) continue
				parent.set(dep, current)
				queue.push(dep)
			}
		}
	}
	for (const file of walk(distDir, (p) => p.endsWith('.js'))) {
		if (factsOf(file).client) walkFrom(file, `'use client' ${relative(pkgDir, file)}`, false)
	}
	for (const entry of sharedEntries) walkFrom(join(pkgDir, entry), `shared entry ${entry}`, true)
	return errors
}

/** dist targets of the `./shared` export and any `./<name>/shared` beside it. */
const sharedEntryTargets = (exports: unknown): string[] => {
	if (!exports || typeof exports !== 'object') return []
	return Object.entries(exports as Record<string, unknown>)
		.filter(([key]) => key === './shared' || key.endsWith('/shared'))
		.flatMap(([, value]) => exportTargets(value))
		.filter((target) => target.startsWith('./dist/') && target.endsWith('.js'))
		.filter((target, index, all) => all.indexOf(target) === index)
}

const verifyPackage = async (pkgDir: string): Promise<string[]> => {
	const errors: string[] = []
	const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
		exports?: unknown
		name: string
		private?: boolean
		sideEffects?: unknown
	}
	if (pkg.private) return errors

	const distDir = join(pkgDir, 'dist')
	if (!existsSync(distDir)) {
		errors.push('dist/ missing, run the build first')
		return errors
	}

	if (existsSync(join(distDir, 'node_modules'))) {
		errors.push(
			'dist/node_modules exists: a runtime import is not declared as a dependency or peerDependency and got inlined'
		)
	}

	const srcDir = join(pkgDir, 'src')
	const srcFiles = walk(srcDir, (p) => /\.(ts|tsx)$/.test(p) && !p.includes('.test.'))
	for (const srcFile of srcFiles) {
		const match = DIRECTIVE_RE.exec(readFileSync(srcFile, 'utf8').trimStart())
		if (!match) continue
		const distFile = join(distDir, relative(srcDir, srcFile).replace(/\.(tsx|ts)$/, '.js'))
		if (!existsSync(distFile)) {
			console.warn(
				`  warn ${pkg.name}: ${relative(pkgDir, srcFile)} has ${match[0]} but is not reachable from any entry (dead module?)`
			)
			continue
		}
		if (!DIRECTIVE_RE.test(firstLine(distFile))) {
			errors.push(`${relative(pkgDir, distFile)} lost its '${match[0]}' directive`)
		}
	}

	let stylesheetImports = 0
	for (const distFile of walk(distDir, (p) => p.endsWith('.js'))) {
		const content = readFileSync(distFile, 'utf8')
		if (HOOK_CALL_RE.test(content) && !DIRECTIVE_RE.test(content.trimStart())) {
			errors.push(
				`${relative(pkgDir, distFile)} calls React hooks but does not start with 'use client'`
			)
		}
		for (const [, specifier = ''] of content.matchAll(CSS_IMPORT_RE)) {
			if (!specifier.startsWith('.')) continue
			stylesheetImports++
			if (!existsSync(join(dirname(distFile), specifier))) {
				errors.push(
					`${relative(pkgDir, distFile)} imports ${specifier}, which is not in dist (add it to the build's \`copy\`)`
				)
			}
		}
	}
	if (stylesheetImports > 0 && pkg.sideEffects === false) {
		console.warn(
			`  warn ${pkg.name}: dist imports stylesheets but package.json sets "sideEffects": false, so a production bundler may drop them`
		)
	}

	errors.push(...verifyBrowserGraphs(pkgDir, distDir, sharedEntryTargets(pkg.exports)))

	for (const target of exportTargets(pkg.exports ?? {})) {
		if (!existsSync(join(pkgDir, target))) {
			errors.push(`exports target ${target} does not exist`)
		}
	}

	const { messages, pkg: manifest } = await publint({ pkgDir, strict: true })
	for (const message of messages) {
		if (message.type === 'error' || message.type === 'warning') {
			errors.push(`publint: ${formatMessage(message, manifest)}`)
		}
	}

	return errors
}

const main = async (): Promise<void> => {
	const onlyBuilt = process.argv.slice(2).includes('--only-built')
	let failed = false
	for (const name of readdirSync(PACKAGES_DIR).sort()) {
		const pkgDir = join(PACKAGES_DIR, name)
		if (!existsSync(join(pkgDir, 'package.json'))) continue
		if (onlyBuilt && !existsSync(join(pkgDir, 'dist'))) {
			console.log(`  skip ${name} (no dist, outside this run's affected scope)`)
			continue
		}
		const errors = await verifyPackage(pkgDir)
		if (errors.length === 0) {
			console.log(`  ok   ${name}`)
		} else {
			failed = true
			console.error(`  FAIL ${name}`)
			for (const error of errors) console.error(`       ${error}`)
		}
	}
	if (failed) process.exit(1)
}

await main()
