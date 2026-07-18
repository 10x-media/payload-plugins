import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Import the generator from source, not the package export, so a bare regen picks
// up codegen changes without a rebuild (the sibling generate:manifests does the same).
import { generateIconManifest } from '../../src/fields/icon/codegen/generate'
import { socialSource } from '../icon-adapters/social/source'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(dirname, '../icon-adapters/social/generated')

const result = await generateIconManifest({
	outDir,
	regenCommand: 'pnpm --filter @10x-media/fields generate:social',
	source: socialSource,
})
console.log(`social: ${result.iconCount} icons`)
for (const file of result.files) console.log(`  ${file}`)
