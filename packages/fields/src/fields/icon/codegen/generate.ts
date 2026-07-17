import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { emitImportsModule, emitManifestModule } from './emit'
import { loadLucideSource } from './sources/lucide'
import { loadRadixSource } from './sources/radix'
import { loadTablerSource } from './sources/tabler'
import type { GenerateIconManifestOptions, LoadedIconSource } from './types'

const loadSource = async (
	source: GenerateIconManifestOptions['source']
): Promise<LoadedIconSource> => {
	if (source === 'lucide') return loadLucideSource()
	if (source === 'radix') return loadRadixSource()
	if (source === 'tabler') return loadTablerSource()
	return source
}

export const generateIconManifest = async (
	options: GenerateIconManifestOptions
): Promise<{ iconCount: number; files: string[] }> => {
	const { icons: rawIcons, importFor } = await loadSource(options.source)
	const icons = [...rawIcons].sort((a, b) => a.name.localeCompare(b.name))
	const seen = new Set<string>()
	for (const icon of icons) {
		if (seen.has(icon.name)) throw new Error(`duplicate icon name: ${icon.name}`)
		seen.add(icon.name)
	}
	const categories = [...new Set(icons.flatMap((icon) => icon.categories))].sort()
	await mkdir(options.outDir, { recursive: true })
	const files: string[] = []
	const manifestPath = path.join(options.outDir, 'manifest.ts')
	await writeFile(manifestPath, emitManifestModule(icons, categories))
	files.push(manifestPath)
	if (importFor) {
		const importsPath = path.join(options.outDir, 'imports.ts')
		await writeFile(importsPath, emitImportsModule(icons, importFor))
		files.push(importsPath)
	}
	return { files, iconCount: icons.length }
}
