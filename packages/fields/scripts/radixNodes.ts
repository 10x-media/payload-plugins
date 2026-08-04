import { createRequire } from 'node:module'
import type { ComponentType } from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { IconNodeMap } from '../src/types'
import { parseSvgMarkup } from './svgNodes'

const require = createRequire(import.meta.url)

/**
 * Every radix glyph shares one canvas, which the adapter declares once for the whole
 * library. Generation fails loudly if that stops being true.
 */
const RADIX_VIEWBOX = '0 0 15 15'

/**
 * Extracts radix node-data by rendering each icon component once.
 *
 * Radix ships React components rather than raw SVG, which is the only reason it sat on the
 * drawer's per-icon path while lucide and tabler rendered in bulk. Rendering them here
 * closes that gap.
 *
 * This lives in the repo's own scripts rather than the published codegen deliberately: it
 * needs a DOM to parse the rendered markup, and jsdom has no business becoming a runtime
 * dependency of `@10x-media/fields/icon/codegen` for consumers who only generate their own
 * libraries. The output is committed, so nobody downstream ever runs it.
 */
export const loadRadixNodes = (names: Map<string, string>): IconNodeMap => {
	const mod = require('@radix-ui/react-icons') as Record<string, unknown>
	const nodes: IconNodeMap = {}
	for (const [name, exportName] of names) {
		const Component = mod[exportName] as ComponentType<Record<string, never>>
		if (!Component) throw new Error(`radix: no export "${exportName}" for icon "${name}"`)
		const parsed = parseSvgMarkup(renderToStaticMarkup(createElement(Component)))
		if (parsed.canvas.viewBox !== RADIX_VIEWBOX) {
			throw new Error(
				`radix: icon "${name}" has viewBox "${parsed.canvas.viewBox}", expected ${RADIX_VIEWBOX}`
			)
		}
		nodes[name] = parsed.nodes
	}
	return nodes
}

/** Mirrors the export-name derivation in the published radix source, so the two cannot drift. */
export const radixExportNames = (): Map<string, string> => {
	const mod = require('@radix-ui/react-icons') as Record<string, unknown>
	const names = new Map<string, string>()
	for (const exportName of Object.keys(mod)
		.filter((key) => key.endsWith('Icon'))
		.sort()) {
		const name = exportName
			.slice(0, -'Icon'.length)
			.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
			.replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
			.toLowerCase()
		names.set(name, exportName)
	}
	return names
}
