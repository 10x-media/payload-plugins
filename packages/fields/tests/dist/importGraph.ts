import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist')
export const hasDist = existsSync(distDir)

// biome-ignore lint/plugin/noProcessEnv: test entry env boundary
if (process.env.REQUIRE_DIST === '1' && !hasDist) {
	throw new Error(
		'dist/ not found. Run `pnpm build fields` before `pnpm --filter @10x-media/fields test:dist`.'
	)
}

/**
 * Static import specifiers only. Both patterns anchor to the start of a line, so a
 * dynamic `import(...)` sitting inside an expression is never matched, which is the
 * whole point: dynamic chunks must stay off these graphs.
 */
export const staticImportsOf = (source: string): string[] => {
	const specifiers: string[] = []
	const fromRe = /(?:^|\n)\s*(?:import|export)[^;'"]*?from\s+['"]([^'"]+)['"]/g
	const bareRe = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g
	for (const re of [fromRe, bareRe]) {
		let match = re.exec(source)
		while (match) {
			if (match[1] !== undefined) specifiers.push(match[1])
			match = re.exec(source)
		}
	}
	return specifiers
}

export type UnresolvedImport = { from: string; specifier: string }

const walk = (
	entry: string,
	onExternal?: (specifier: string) => void,
	onUnresolved?: (unresolved: UnresolvedImport) => void
): Set<string> => {
	const visited = new Set<string>()
	const queue = [entry]
	while (queue.length > 0) {
		const file = queue.pop() as string
		if (visited.has(file)) continue
		visited.add(file)
		if (!existsSync(file)) continue
		for (const specifier of staticImportsOf(readFileSync(file, 'utf8'))) {
			// Built JS carries bare `import "./x.css"` statements that are not JS modules
			if (specifier.startsWith('.')) {
				if (specifier.endsWith('.css')) continue
				let resolved = resolve(dirname(file), specifier)
				if (!resolved.endsWith('.js')) resolved = `${resolved}.js`
				if (!existsSync(resolved)) onUnresolved?.({ from: file, specifier })
				queue.push(resolved)
			} else {
				onExternal?.(specifier)
			}
		}
	}
	return visited
}

/** External specifiers reachable from an entry without crossing a dynamic import. */
export const collectExternals = (entry: string): Set<string> => {
	const externals = new Set<string>()
	walk(entry, (specifier) => externals.add(specifier))
	return externals
}

/** Static (non-dynamic) file closure of an entry, so dynamic `import()` chunks stay out. */
export const collectStaticFiles = (entry: string): Set<string> => walk(entry)

/**
 * Relative specifiers `walk` could not resolve to a file on disk. Nonempty means the walk
 * truncated silently and every graph assertion built on it may be vacuous.
 */
export const collectUnresolved = (entry: string): UnresolvedImport[] => {
	const unresolved: UnresolvedImport[] = []
	walk(entry, undefined, (item) => unresolved.push(item))
	return unresolved
}
