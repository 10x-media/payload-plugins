import { generateIconManifest } from '../src/fields/icon/codegen/generate'
import { loadRadixSource } from '../src/fields/icon/codegen/sources/radix'
import type { IconManifestSource } from '../src/fields/icon/codegen/types'
import { loadRadixNodes, radixExportNames } from './radixNodes'

/**
 * Radix goes through a custom source rather than the built-in `'radix'` one, because its
 * node-data has to be extracted by rendering each component, and that needs a DOM. Keeping
 * that here rather than in the published codegen is what stops jsdom becoming a runtime
 * dependency of `@10x-media/fields/icon/codegen` for every consumer.
 */
const radixSource = (): IconManifestSource => {
	const base = loadRadixSource()
	return { ...base, nodes: loadRadixNodes(radixExportNames()) }
}

const targets: { source: IconManifestSource; outDir: string }[] = [
	{ source: 'lucide', outDir: 'src/fields/icon/adapters/lucide/generated' },
	{ source: radixSource(), outDir: 'src/fields/icon/adapters/radix/generated' },
	{ source: 'tabler', outDir: 'src/fields/icon/adapters/tabler/generated' },
]

for (const target of targets) {
	const result = await generateIconManifest(target)
	const label = typeof target.source === 'string' ? target.source : 'radix'
	console.log(`${label}: ${result.iconCount} icons`)
	for (const file of result.files) console.log(`  ${file}`)
}
