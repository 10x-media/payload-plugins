import { existsSync } from 'node:fs'
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
			icons: { name: string; categories: string[] }[]
			categories: string[]
		}
		expect(parsed.icons.map((icon) => icon.name)).toEqual(['alpha', 'zeta'])
		expect(parsed.icons[1]?.categories).toEqual(['a', 'b'])
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

	it('emits nodes.ts when the source carries node-data', async () => {
		const outDir = await mkdtemp(path.join(tmpdir(), 'fields-codegen-'))
		dirs.push(outDir)
		const result = await generateIconManifest({
			outDir,
			source: {
				icons: [{ name: 'solo', tags: [], categories: [] }],
				nodes: { solo: [['path', { d: 'M0 0h10' }]] },
			},
		})
		expect(result.files.map((file) => path.basename(file))).toEqual(['manifest.ts', 'nodes.ts'])
		const nodes = await readFile(path.join(outDir, 'nodes.ts'), 'utf8')
		expect(nodes).toContain('export const nodes')
		expect(nodes).toContain(`"solo":[["path",{"d":"M0 0h10"}]]`)
	})

	it('rejects generation when node-data is missing a manifest icon', async () => {
		const outDir = await mkdtemp(path.join(tmpdir(), 'fields-codegen-'))
		dirs.push(outDir)
		await expect(
			generateIconManifest({
				outDir,
				source: {
					icons: [
						{ name: 'has-nodes', tags: [], categories: [] },
						{ name: 'no-nodes', tags: [], categories: [] },
					],
					nodes: { 'has-nodes': [['path', { d: 'M0 0' }]] },
				},
			})
		).rejects.toThrow('no node-data')
		expect(existsSync(path.join(outDir, 'manifest.ts'))).toBe(false)
	})

	// Kebab-case was never the real constraint, only the shape the two bundled
	// libraries happened to have. A library keyed by country code is legitimate.
	it('accepts uppercase, non-kebab names end to end', async () => {
		const outDir = await mkdtemp(path.join(tmpdir(), 'fields-codegen-'))
		dirs.push(outDir)
		const result = await generateIconManifest({
			outDir,
			source: {
				icons: [
					{ categories: [], label: 'Hungary', name: 'HUN', tags: ['hungary'] },
					{ categories: [], label: 'Switzerland', name: 'SUI', tags: ['switzerland'] },
				],
				importFor: (icon) => ({ module: `flags/${icon.name}.js` }),
			},
		})
		expect(result.iconCount).toBe(2)
		const manifest = await readFile(path.join(outDir, 'manifest.ts'), 'utf8')
		const parsed = JSON.parse(manifest.slice(manifest.indexOf('= ') + 2)) as {
			icons: { label?: string; name: string }[]
		}
		expect(parsed.icons.map((icon) => icon.name)).toEqual(['HUN', 'SUI'])
		expect(parsed.icons[0]?.label).toBe('Hungary')
		const imports = await readFile(path.join(outDir, 'imports.ts'), 'utf8')
		expect(imports).toContain(`'HUN': () => import('flags/HUN.js'),`)
	})

	it.each([
		["ev'il", 'a quote would escape the emitted key'],
		['back\\slash', 'a backslash would escape the emitted key'],
		['has space', 'whitespace breaks search normalisation'],
		['ns:name', 'a colon reparses as a different library and name'],
		['', 'an empty name addresses nothing'],
	])('rejects the unsafe icon name %j', async (name) => {
		const outDir = await mkdtemp(path.join(tmpdir(), 'fields-codegen-'))
		dirs.push(outDir)
		await expect(
			generateIconManifest({ outDir, source: { icons: [{ categories: [], name, tags: [] }] } })
		).rejects.toThrow('invalid icon name')
		expect(existsSync(path.join(outDir, 'manifest.ts'))).toBe(false)
	})

	// Drawer search is case-insensitive, so these two are indistinguishable to an
	// editor even though they are distinct keys everywhere else.
	it('rejects names that differ only by case', async () => {
		const outDir = await mkdtemp(path.join(tmpdir(), 'fields-codegen-'))
		dirs.push(outDir)
		await expect(
			generateIconManifest({
				outDir,
				source: {
					icons: [
						{ categories: [], name: 'HUN', tags: [] },
						{ categories: [], name: 'hun', tags: [] },
					],
				},
			})
		).rejects.toThrow('differ only by case')
	})

	it('still rejects an exact duplicate name', async () => {
		const outDir = await mkdtemp(path.join(tmpdir(), 'fields-codegen-'))
		dirs.push(outDir)
		await expect(
			generateIconManifest({
				outDir,
				source: {
					icons: [
						{ categories: [], name: 'solo', tags: [] },
						{ categories: [], name: 'solo', tags: [] },
					],
				},
			})
		).rejects.toThrow('duplicate icon name: solo')
	})

	it('rejects module specifiers that would break out of the emitted literal', async () => {
		const outDir = await mkdtemp(path.join(tmpdir(), 'fields-codegen-'))
		dirs.push(outDir)
		await expect(
			generateIconManifest({
				outDir,
				source: {
					icons: [{ name: 'solo', tags: [], categories: [] }],
					importFor: () => ({ module: "x'); evil(); ('" }),
				},
			})
		).rejects.toThrow('unsafe module specifier')
		expect(existsSync(path.join(outDir, 'manifest.ts'))).toBe(false)
	})

	it('rejects export names that are not identifiers', async () => {
		const outDir = await mkdtemp(path.join(tmpdir(), 'fields-codegen-'))
		dirs.push(outDir)
		await expect(
			generateIconManifest({
				outDir,
				source: {
					icons: [{ name: 'solo', tags: [], categories: [] }],
					importFor: () => ({ module: 'lib', exportName: 'Icon); evil((' }),
				},
			})
		).rejects.toThrow('export name is not an identifier')
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
