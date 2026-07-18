import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateIconManifest } from '@10x-media/fields/icon/codegen'
import { socialSource } from '../icon-adapters/social/source'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(dirname, '../icon-adapters/social/generated')

const result = await generateIconManifest({ outDir, source: socialSource })
console.log(`social: ${result.iconCount} icons`)
for (const file of result.files) console.log(`  ${file}`)
