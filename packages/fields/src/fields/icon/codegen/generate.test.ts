import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { GENERATED_HEADER } from './emit'
import { generateIconManifest } from './generate'

const dirs: string[] = []

afterAll(async () => {
	await Promise.all(dirs.map((dir) => rm(dir, { force: true, recursive: true })))
})

describe('generateIconManifest', () => {
	it('emits manifest + imports for a custom source, sorted and deduplicated categories', async () => {
		const outDir = await mkdtemp(path.join(tmpdir(), 'fields-codegen-'))
		dirs.push(outDir)
		const result = await generateIconManifest({
			outDir,
			source: {
				icons: [
					{ name: 'zeta', tags: ['last'], categories: ['b', 'a'] },
					{ name: 'alpha', tags: [], categories: ['a'] },
				],
				importFor: (icon) => ({ module: `custom-lib/${icon.name}.js` }),
			},
		})
		expect(result.iconCount).toBe(2)
		expect(result.files.map((file) => path.basename(file))).toEqual(['manifest.ts', 'imports.ts'])
		const manifest = await readFile(path.join(outDir, 'manifest.ts'), 'utf8')
		expect(manifest.startsWith(GENERATED_HEADER)).toBe(true)
		const parsed = JSON.parse(manifest.slice(manifest.indexOf('= ') + 2)) as {
			icons: { name: string }[]
			categories: string[]
		}
		expect(parsed.icons.map((icon) => icon.name)).toEqual(['alpha', 'zeta'])
		expect(parsed.categories).toEqual(['a', 'b'])
		const imports = await readFile(path.join(outDir, 'imports.ts'), 'utf8')
		expect(imports).toContain(`'alpha': () => import('custom-lib/alpha.js'),`)
	})

	it('skips imports.ts when the source has no importFor', async () => {
		const outDir = await mkdtemp(path.join(tmpdir(), 'fields-codegen-'))
		dirs.push(outDir)
		const result = await generateIconManifest({
			outDir,
			source: { icons: [{ name: 'solo', tags: [], categories: [] }] },
		})
		expect(result.files.map((file) => path.basename(file))).toEqual(['manifest.ts'])
	})

	it('rejects duplicate icon names', async () => {
		const outDir = await mkdtemp(path.join(tmpdir(), 'fields-codegen-'))
		dirs.push(outDir)
		await expect(
			generateIconManifest({
				outDir,
				source: {
					icons: [
						{ name: 'dup', tags: [], categories: [] },
						{ name: 'dup', tags: [], categories: [] },
					],
				},
			})
		).rejects.toThrow('duplicate icon name')
	})
})
