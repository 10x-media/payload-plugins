import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { emitImportsModule, emitManifestModule, emitNodesModule, generatedHeader } from './emit'
import { loadLucideSource } from './sources/lucide'
import { loadRadixSource } from './sources/radix'
import { loadTablerSource } from './sources/tabler'
import type { GenerateIconManifestOptions, LoadedIconSource } from './types'

/** The stored value format (`library:icon-name`) and every picker lookup assume kebab-case. */
const ICON_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

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
	const seen = new Set<string>()
	for (const icon of icons) {
		if (!ICON_NAME.test(icon.name)) {
			throw new Error(`invalid icon name: "${icon.name}" (expected kebab-case, e.g. "arrow-up")`)
		}
		if (seen.has(icon.name)) throw new Error(`duplicate icon name: ${icon.name}`)
		seen.add(icon.name)
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
