import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const MANIFEST = fileURLToPath(new URL('../../package.json', import.meta.url))

/**
 * Peers a host may leave out, which the plugin loads by name at runtime when it needs them. A type
 * of theirs in a published declaration fails `tsc` with `skipLibCheck: false` on such a host.
 */
const optionalPeers = (): string[] => {
	const manifest: { peerDependenciesMeta?: Record<string, { optional?: boolean }> } = JSON.parse(
		readFileSync(MANIFEST, 'utf8')
	)
	return Object.entries(manifest.peerDependenciesMeta ?? {})
		.filter(([, meta]) => meta.optional === true)
		.map(([name]) => name)
}

const sourceFiles = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			return sourceFiles(path)
		}
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
	})

/** Every module a file names in an import, an export from, or an `import('...')` type. */
const specifiersOf = (file: string): string[] => {
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true)
	const found: string[] = []
	const visit = (node: ts.Node): void => {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			found.push(node.moduleSpecifier.text)
		}
		if (
			ts.isImportTypeNode(node) &&
			ts.isLiteralTypeNode(node.argument) &&
			ts.isStringLiteral(node.argument.literal)
		) {
			found.push(node.argument.literal.text)
		}
		ts.forEachChild(node, visit)
	}
	visit(source)
	return found
}

describe('optional peers', () => {
	// No database adapter is a peer: each pins payload's exact version, which the payload peer bounds.
	it('are named in package.json, the SDKs alone', () => {
		expect(optionalPeers().sort()).toEqual(['@google-analytics/data', 'maxmind'])
	})

	// The SDKs are typed structurally in core/sdks.ts and loaded by name in plugin/peers.ts.
	it('are never imported by published source, not even for a type', () => {
		const peers = optionalPeers()
		const imports = sourceFiles(SRC).flatMap((file) =>
			specifiersOf(file)
				.filter((specifier) =>
					peers.some((peer) => specifier === peer || specifier.startsWith(`${peer}/`))
				)
				.map((specifier) => `${relative(SRC, file)}: ${specifier}`)
		)
		expect(imports).toEqual([])
	})
})
