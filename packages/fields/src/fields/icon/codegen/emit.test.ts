import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import type { IconMeta, IconNodeMap } from '../../../types'
import { emitImportsModule, emitManifestModule, emitNodesModule, GENERATED_HEADER } from './emit'

/**
 * Typechecks one emitted module with the real compiler and returns its diagnostics.
 *
 * The label defect shipped because every emit test inspected strings while none asked
 * whether the emitted data satisfies the emitted annotation. The bundled libraries never
 * set the optional fields, so their generated output could not disagree with a stale
 * annotation; a consumer's could, and did.
 */
const typecheckEmitted = (source: string): string[] => {
	const fileName = 'generated.ts'
	const host = ts.createCompilerHost({ strict: true })
	const readFile = host.getSourceFile.bind(host)
	host.getSourceFile = (name, languageVersion) =>
		name === fileName
			? ts.createSourceFile(name, source, languageVersion, true)
			: readFile(name, languageVersion)
	const program = ts.createProgram(
		[fileName],
		{ noEmit: true, skipLibCheck: true, strict: true },
		host
	)
	return ts
		.getPreEmitDiagnostics(program)
		.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
}

const icons: IconMeta[] = [
	{ name: 'alpha', tags: ['first'], categories: ['letters'] },
	{ name: 'beta', tags: [], categories: [] },
]

describe('codegen emitters', () => {
	// The annotation must accept everything the data can carry. beta.1 emitted label in the
	// data but not the annotation, which is one TS2353 per labelled icon in a strict consumer.
	it('emits a manifest whose data satisfies its own annotation when icons carry labels', () => {
		const labelled: IconMeta[] = [
			{ categories: ['flags'], label: 'Hungary', name: 'HUN', tags: ['hungary'] },
			{ categories: ['flags'], label: { de: 'Schweiz', en: 'Switzerland' }, name: 'SUI', tags: [] },
		]
		const output = emitManifestModule(labelled, ['flags'])
		expect(typecheckEmitted(output)).toEqual([])
	})

	it('still typechecks a label-less manifest', () => {
		expect(typecheckEmitted(emitManifestModule(icons, ['letters']))).toEqual([])
	})

	// Same defect class one field over: IconNode permits nested children, so the nodes
	// annotation must too, or a source emitting a <g> hits the identical mismatch.
	it('emits nodes whose data satisfies its own annotation when glyphs nest', () => {
		const nested: IconNodeMap = {
			alpha: [['g', { transform: 'scale(2)' }, [['circle', { cx: '1', cy: '1', r: '1' }]]]],
			beta: [['path', { d: 'M0 0' }]],
		}
		const output = emitNodesModule(
			[
				{ categories: [], name: 'alpha', tags: [] },
				{ categories: [], name: 'beta', tags: [] },
			],
			nested
		)
		expect(typecheckEmitted(output)).toEqual([])
	})

	it('emits a manifest module with header, sorted categories, and parseable data', () => {
		const output = emitManifestModule(icons, ['letters'])
		expect(output.startsWith(GENERATED_HEADER)).toBe(true)
		const json = output.slice(output.indexOf('= ') + 2)
		expect(JSON.parse(json)).toEqual({ icons, categories: ['letters'] })
	})

	it('emits an imports module with named-export picks and bare default imports', () => {
		const output = emitImportsModule(icons, (icon) =>
			icon.name === 'alpha'
				? { module: 'fake-icons', exportName: 'AlphaIcon' }
				: { module: `fake-icons/lib/${icon.name}.mjs` }
		)
		expect(output.startsWith(GENERATED_HEADER)).toBe(true)
		expect(output).toContain(
			`'alpha': () => import('fake-icons').then((m) => ({ default: m.AlphaIcon })),`
		)
		expect(output).toContain(`'beta': () => import('fake-icons/lib/beta.mjs'),`)
		expect(output).toContain('export const iconImports')
	})

	// The name is interpolated bare into a single-quoted key, so the emitter must guard
	// it in its own right. Relaxing the name rule in generate.ts removed the kebab
	// regex that had been covering this by accident.
	it('rejects an icon name that would escape the emitted key', () => {
		expect(() =>
			emitImportsModule([{ categories: [], name: "ev'il", tags: [] }], () => ({ module: 'x' }))
		).toThrow('unsafe icon name')
	})

	it('emits a nodes module in manifest order with parseable node-data', () => {
		const nodes: IconNodeMap = {
			beta: [['circle', { cx: '12', cy: '12', r: '4' }]],
			alpha: [['path', { d: 'M2 2h20' }]],
		}
		const output = emitNodesModule(icons, nodes)
		expect(output.startsWith(GENERATED_HEADER)).toBe(true)
		expect(output).toContain('export const nodes')
		const parsed = JSON.parse(output.slice(output.indexOf('= ') + 2)) as IconNodeMap
		// Emitted in the sorted icon order (alpha before beta), not source order.
		expect(Object.keys(parsed)).toEqual(['alpha', 'beta'])
		expect(parsed.alpha).toEqual([['path', { d: 'M2 2h20' }]])
	})

	it('rejects a manifest icon with no node-data', () => {
		expect(() => emitNodesModule(icons, { alpha: [['path', { d: 'M0 0' }]] })).toThrow(
			'no node-data'
		)
	})

	it('rejects an unexpected SVG node tag', () => {
		const nodes: IconNodeMap = {
			alpha: [['script', { d: 'M0 0' }]],
			beta: [['path', { d: 'M0 0' }]],
		}
		expect(() => emitNodesModule(icons, nodes)).toThrow('unexpected SVG node tag "script"')
	})
})
