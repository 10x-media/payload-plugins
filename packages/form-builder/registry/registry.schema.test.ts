import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultRenderers } from '@10x-media/form-builder/react'
import { describe, expect, it } from 'vitest'
import { shadcnRenderers } from './form-builder/renderers'

const registryDir = dirname(fileURLToPath(import.meta.url))
const registry = JSON.parse(readFileSync(resolve(registryDir, 'registry.json'), 'utf8')) as {
	name: string
	items: Array<{
		name: string
		type: string
		files: Array<{ path: string; type: string; target?: string }>
		registryDependencies?: string[]
		dependencies?: string[]
	}>
}

const VALID_TYPES = new Set([
	'registry:lib',
	'registry:block',
	'registry:component',
	'registry:ui',
	'registry:hook',
	'registry:theme',
	'registry:page',
	'registry:file',
	'registry:style',
	'registry:base',
	'registry:font',
	'registry:item',
])

describe('registry.json', () => {
	it('has a name and at least one item', () => {
		expect(registry.name).toBeTruthy()
		expect(registry.items.length).toBeGreaterThan(0)
	})

	it('every item has a valid type and existing files', () => {
		for (const item of registry.items) {
			expect(item.name).toBeTruthy()
			expect(VALID_TYPES.has(item.type)).toBe(true)
			for (const file of item.files) {
				expect(VALID_TYPES.has(file.type)).toBe(true)
				expect(existsSync(resolve(registryDir, file.path))).toBe(true)
				if (file.type === 'registry:file' || file.type === 'registry:page') {
					expect(typeof file.target).toBe('string')
				}
			}
		}
	})

	it('the form block declares the package dependency and shadcn primitive registry dependencies', () => {
		const block = registry.items.find((item) => item.name === 'form')
		expect(block?.dependencies).toContain('@10x-media/form-builder')
		expect(block?.registryDependencies).toEqual(
			expect.arrayContaining(['input', 'textarea', 'label'])
		)
	})
})

describe('registry renderer parity', () => {
	it('ships a shadcn renderer for every built-in field type', () => {
		// The registry copies are hand-maintained; assert they cover exactly the package's
		// built-in renderer set so a new field type cannot ship without its shadcn renderer.
		expect(Object.keys(shadcnRenderers).sort()).toEqual(Object.keys(defaultRenderers).sort())
	})
})
