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
 * 3. No undirected hook callers: any dist file calling React hooks must start
 *    with 'use client'.
 * 4. Every package.json `exports` target must exist on disk.
 * 5. publint must report no errors.
 *
 * Run standalone via `pnpm check:dist` (after a build) or in CI. Pass `--only-built` to
 * skip packages that have no `dist/` at all, which is what an affected-scoped CI build
 * leaves behind: the packages outside the run's scope were never built, and reporting
 * them as failures would defeat the scoping.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { publint } from 'publint'
import { formatMessage } from 'publint/utils'

const REPO_ROOT = process.cwd()
const PACKAGES_DIR = join(REPO_ROOT, 'packages')

const DIRECTIVE_RE = /^(['"])use (client|server)\1/
const HOOK_CALL_RE =
	/\buse(State|Ref|Effect|LayoutEffect|Id|Callback|Memo|Transition|Reducer|Context|SyncExternalStore)\(/

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

const verifyPackage = async (pkgDir: string): Promise<string[]> => {
	const errors: string[] = []
	const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
		exports?: unknown
		name: string
		private?: boolean
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

	for (const distFile of walk(distDir, (p) => p.endsWith('.js'))) {
		const content = readFileSync(distFile, 'utf8')
		if (HOOK_CALL_RE.test(content) && !DIRECTIVE_RE.test(content.trimStart())) {
			errors.push(
				`${relative(pkgDir, distFile)} calls React hooks but does not start with 'use client'`
			)
		}
	}

	for (const target of exportTargets(pkg.exports ?? {})) {
		if (!existsSync(join(pkgDir, target))) {
			errors.push(`exports target ${target} does not exist`)
		}
	}

	const { messages } = await publint({ pkgDir, strict: true })
	for (const message of messages) {
		if (message.type === 'error' || message.type === 'warning') {
			errors.push(
				`publint: ${formatMessage(message, JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')))}`
			)
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
