import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { colorField, presetsFromArray } from '../../src/exports/color'
import { fields } from '../../src/index'
import type { ColorPreset, FieldsResolverArgs } from '../../src/types'

const schemePresets: ColorPreset[] = [
	{ key: 'flat', label: 'Flat', value: '#0ea5e9' },
	{ key: 'brand', label: 'Brand', value: { dark: '#0369a1', light: '#0ea5e9' } },
]

const palettes: CollectionConfig = {
	slug: 'palettes',
	fields: [
		{ name: 'name', type: 'text', required: true },
		{
			name: 'rows',
			type: 'array',
			fields: [
				{ name: 'key', type: 'text', required: true },
				{ name: 'label', type: 'text' },
				colorField({ name: 'value', required: true }),
				colorField({ name: 'valueDark' }),
			],
		},
	],
}

/** Exercises presetsFromArray against real stored docs, not a hand-built fixture. */
const paletteRowPresets = async ({ req }: FieldsResolverArgs): Promise<ColorPreset[]> => {
	const result = await req.payload.find({ collection: 'palettes', depth: 0, limit: 25 })
	return result.docs.flatMap((doc) =>
		presetsFromArray({
			doc: doc as unknown as Record<string, unknown>,
			key: 'key',
			keyPrefix: `${(doc as unknown as { name: string }).name}/`,
			label: 'label',
			path: 'rows',
			value: { dark: 'valueDark', light: 'value' },
		})
	)
}

const themes: CollectionConfig = {
	slug: 'themes',
	fields: [
		{ name: 'title', type: 'text', required: true },
		...colorField({
			linked: { fallback: { dark: '#1e293b', light: '#94a3b8' }, resolve: 'schemes' },
			name: 'surface',
			presets: schemePresets,
		}),
		...colorField({ linked: true, name: 'legacy', presets: schemePresets }),
		...colorField({
			linked: { resolve: 'schemes' },
			name: 'fromRows',
			presets: paletteRowPresets,
		}),
	],
}

describeForDb('fields color schemes', {}, (db) => {
	let booted: BootedPayload

	const create = (data: Record<string, unknown>) =>
		booted.payload.create({ collection: 'themes', data })

	beforeAll(async () => {
		booted = await bootPayload({ collections: [themes, palettes], db, plugin: fields({}) })
		await booted.payload.create({
			collection: 'palettes',
			data: {
				name: 'acme',
				rows: [
					{ key: 'surface', label: 'Acme surface', value: '#f5f3ff', valueDark: '#1e1b4b' },
					{ key: 'halfPair', label: 'Half pair', value: '#22c55e' },
				],
			},
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('resolves a scheme preset to the pair and a flat preset to both members', async () => {
		const scheme = await create({ surface: 'preset:brand', title: 'Brand' })
		expect(scheme.surfaceResolved).toEqual({ dark: '#0369a1', light: '#0ea5e9' })

		const flat = await create({ surface: 'preset:flat', title: 'Flat' })
		expect(flat.surfaceResolved).toEqual({ dark: '#0ea5e9', light: '#0ea5e9' })
	})

	it('inflates a free color and falls back to the scheme fallback', async () => {
		const free = await create({ surface: '#123456', title: 'Free' })
		expect(free.surfaceResolved).toEqual({ dark: '#123456', light: '#123456' })

		const gone = await create({ surface: 'preset:removed', title: 'Gone' })
		expect(gone.surfaceResolved).toEqual({ dark: '#1e293b', light: '#94a3b8' })
	})

	it('keeps a resolve-value sibling flat when the resolver returns schemes', async () => {
		const doc = await create({ legacy: 'preset:brand', title: 'Legacy' })
		expect(doc.legacyResolved).toBe('#0ea5e9')
	})

	it('resolves presets lifted off array rows, filling a half-filled pair', async () => {
		const full = await create({ fromRows: 'preset:acme/surface', title: 'From rows' })
		expect(full.fromRowsResolved).toEqual({ dark: '#1e1b4b', light: '#f5f3ff' })

		const half = await create({ fromRows: 'preset:acme/halfPair', title: 'Half from rows' })
		expect(half.fromRowsResolved).toEqual({ dark: '#22c55e', light: '#22c55e' })
	})

	it('carries a reference alpha onto both members of the schemes sibling', async () => {
		const doc = await create({ surface: 'preset:brand/40', title: 'Brand at 40' })
		expect(doc.surface).toBe('preset:brand/40')
		expect(doc.surfaceResolved).toEqual({ dark: '#0369a166', light: '#0ea5e966' })
	})

	it('carries a reference alpha onto a resolve-value sibling', async () => {
		const doc = await create({ legacy: 'preset:brand/40', title: 'Legacy at 40' })
		expect(doc.legacyResolved).toBe('#0ea5e966')
	})

	it('leaves the stored reference untouched through an update round trip', async () => {
		const doc = await create({ surface: 'preset:brand', title: 'Round trip' })
		const updated = await booted.payload.update({
			collection: 'themes',
			id: doc.id,
			data: { title: 'Round trip 2' },
		})
		expect(updated.surface).toBe('preset:brand')
		expect(updated.surfaceResolved).toEqual({ dark: '#0369a1', light: '#0ea5e9' })
	})

	it('resolves to null when nothing is stored', async () => {
		const doc = await create({ title: 'Empty' })
		expect(doc.surfaceResolved).toBeNull()
		expect(doc.legacyResolved).toBeNull()
	})
})
