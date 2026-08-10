import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { emitImportsModule, emitManifestModule, emitNodesModule, generatedHeader } from './emit'
import { loadLucideSource } from './sources/lucide'
import { loadRadixSource } from './sources/radix'
import { loadTablerSource } from './sources/tabler'
import type { GenerateIconManifestOptions, LoadedIconSource } from './types'

/**
 * What actually constrains an icon name, which is far narrower than kebab-case:
 *
 * - `:` separates library from name in a stored value, so a name holding one reparses
 *   as a different library entirely
 * - whitespace and control characters break search normalisation, which folds runs of
 *   whitespace and dashes into one separator
 * - `'`, `\` and line terminators would escape the single-quoted key in `imports.ts`
 *
 * Everything else is legitimate: uppercase, digits, dots, underscores, non-latin
 * scripts. Requiring kebab-case rejected libraries keyed by code (`HUN`, `SUI`) and
 * forced them to hand-write an emitter, which is the same wrong assumption as deriving
 * a display label from the name.
 */
const UNSAFE_ICON_NAME = /[\s:'\\]/

/**
 * Control characters that `\s` does not already cover. They would survive into the
 * emitted module and the DOM, where they are invisible and unsearchable.
 */
const hasControlCharacter = (value: string): boolean => {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index)
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true
	}
	return false
}

/** Codepoint order, so committed output does not depend on the generating machine's locale. */
const byCodepoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const loadSource = async (options: GenerateIconManifestOptions): Promise<LoadedIconSource> => {
	const { source } = options
	if (source === 'lucide') {
		return loadLucideSource({ allowMissingCategories: options.allowMissingCategories })
	}
	if (source === 'radix') return loadRadixSource()
	if (source === 'tabler') return loadTablerSource()
	return source
}

export const generateIconManifest = async (
	options: GenerateIconManifestOptions
): Promise<{ iconCount: number; files: string[] }> => {
	const { icons: rawIcons, importFor, nodes } = await loadSource(options)
	const icons = rawIcons
		.map((icon) => ({ ...icon, categories: [...icon.categories].sort(byCodepoint) }))
		.sort((a, b) => byCodepoint(a.name, b.name))
	const seen = new Map<string, string>()
	for (const icon of icons) {
		if (icon.name === '' || UNSAFE_ICON_NAME.test(icon.name) || hasControlCharacter(icon.name)) {
			throw new Error(
				`invalid icon name: "${icon.name}" (must be non-empty and free of whitespace, ":", "'" and "\\")`
			)
		}
		const folded = icon.name.toLowerCase()
		const clash = seen.get(folded)
		if (clash !== undefined) {
			// Drawer search normalises case, so two names differing only by case are
			// indistinguishable to an editor even though they are distinct keys elsewhere.
			throw new Error(
				clash === icon.name
					? `duplicate icon name: ${icon.name}`
					: `icon names differ only by case: "${clash}" and "${icon.name}"`
			)
		}
		seen.set(folded, icon.name)
	}
	const categories = [...new Set(icons.flatMap((icon) => icon.categories))].sort(byCodepoint)
	// Emit every module before writing any, so a specifier or node the emitter
	// rejects cannot leave the directory holding a new manifest beside a stale
	// imports map or node-data.
	const header = generatedHeader(options.regenCommand)
	const manifestSource = emitManifestModule(icons, categories, header)
	const importsSource = importFor ? emitImportsModule(icons, importFor, header) : undefined
	const nodesSource = nodes ? emitNodesModule(icons, nodes, header) : undefined
	await mkdir(options.outDir, { recursive: true })
	const files: string[] = []
	const manifestPath = path.join(options.outDir, 'manifest.ts')
	await writeFile(manifestPath, manifestSource)
	files.push(manifestPath)
	if (importsSource !== undefined) {
		const importsPath = path.join(options.outDir, 'imports.ts')
		await writeFile(importsPath, importsSource)
		files.push(importsPath)
	}
	if (nodesSource !== undefined) {
		const nodesPath = path.join(options.outDir, 'nodes.ts')
		await writeFile(nodesPath, nodesSource)
		files.push(nodesPath)
	}
	return { files, iconCount: icons.length }
}
