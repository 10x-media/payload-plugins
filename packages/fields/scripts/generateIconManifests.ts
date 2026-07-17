import { generateIconManifest } from '../src/fields/icon/codegen/generate'
import type { IconManifestSource } from '../src/fields/icon/codegen/types'

const targets: { source: IconManifestSource; outDir: string }[] = [
	{ source: 'lucide', outDir: 'src/fields/icon/adapters/lucide/generated' },
	{ source: 'radix', outDir: 'src/fields/icon/adapters/radix/generated' },
	{ source: 'tabler', outDir: 'src/fields/icon/adapters/tabler/generated' },
]

for (const target of targets) {
	const result = await generateIconManifest(target)
	console.log(`${String(target.source)}: ${result.iconCount} icons`)
	for (const file of result.files) console.log(`  ${file}`)
}
