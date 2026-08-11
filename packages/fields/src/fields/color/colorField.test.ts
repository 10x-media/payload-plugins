import type { FieldHook, FieldHookArgs } from 'payload'
import { describe, expect, it } from 'vitest'
import type { ColorFormat } from '../../types'
import { colorField } from './colorField'

type ComponentsShape = {
	Cell: { path: string }
	Field: { clientProps: Record<string, unknown>; path: string }
}

const components = (field: { admin?: { components?: unknown } }): ComponentsShape =>
	field.admin?.components as ComponentsShape

/** Runs a beforeValidate hook with a request whose registry carries `registryFormat`. */
const runHook = (
	hook: FieldHook | undefined,
	value: unknown,
	registryFormat?: ColorFormat
): unknown =>
	hook?.({
		req: {
			payload: {
				config: {
					custom: registryFormat
						? { '@10x-media/fields': { color: { format: registryFormat } } }
						: {},
				},
			},
		},
		value,
	} as unknown as FieldHookArgs)

describe('colorField', () => {
	it('returns a text field with defaults and rsc component paths', () => {
		const field = colorField()
		expect(field.name).toBe('color')
		expect(field.type).toBe('text')
		expect(components(field).Field.path).toBe('@10x-media/fields/rsc#ColorFieldServer')
		expect(components(field).Cell.path).toBe('@10x-media/fields/rsc#ColorCell')
		expect(field.hooks?.beforeValidate).toHaveLength(1)
		expect(typeof field.validate).toBe('function')
	})

	it('ships only serializable client props; preset sources stay server-side in custom', () => {
		const field = colorField({ presets: async () => ['#ffffff'] })
		const clientProps = components(field).Field.clientProps
		expect(JSON.parse(JSON.stringify(clientProps))).toEqual(clientProps)
		expect(JSON.stringify(clientProps)).not.toContain('presets')
		const custom = field.custom?.['@10x-media/fields'] as { presets?: unknown }
		expect(typeof custom.presets).toBe('function')
	})

	it('defaults isClearable to true and forwards false to client props', () => {
		const defaulted = components(colorField()).Field.clientProps.colorOptions as {
			isClearable: boolean
		}
		expect(defaulted.isClearable).toBe(true)
		const disabled = components(colorField({ isClearable: false })).Field.clientProps
			.colorOptions as { isClearable: boolean }
		expect(disabled.isClearable).toBe(false)
	})

	it('linked mode returns the field plus a hidden virtual sibling', () => {
		const [main, resolved] = colorField({
			linked: true,
			name: 'brand',
			presets: [{ key: 'a', value: '#ffffff' }],
		})
		expect(main.name).toBe('brand')
		expect(resolved.name).toBe('brandResolved')
		expect(resolved.virtual).toBe(true)
		expect(resolved.admin?.hidden).toBe(true)
		expect(resolved.admin?.disableListColumn).toBe(true)
		expect(resolved.hooks?.afterRead).toHaveLength(1)
	})

	it('applies function-form overrides and derives the sibling from the overridden name', () => {
		const [main, resolved] = colorField({
			linked: true,
			overrides: ({ field }) => ({ ...field, name: 'accent' }),
		})
		expect(main.name).toBe('accent')
		expect(resolved.name).toBe('accentResolved')
	})

	it('normalizes parseable input to the stored format in beforeValidate', async () => {
		const field = colorField({ format: 'rgb' })
		const hook = field.hooks?.beforeValidate?.[0]
		expect(hook).toBeDefined()
		expect(await runHook(hook, 'red')).toBe('rgb(255 0 0)')
		expect(await runHook(hook, 'not-a-color')).toBe('not-a-color')
	})

	it('strips alpha during normalization when alpha is false', async () => {
		const field = colorField({ alpha: false })
		const hook = field.hooks?.beforeValidate?.[0]
		expect(await runHook(hook, '#ff000080')).toBe('#ff0000')
	})

	it('passes preset references through normalization untouched in linked mode', async () => {
		const [main] = colorField({ linked: true })
		const hook = main.hooks?.beforeValidate?.[0]
		expect(await runHook(hook, 'preset:brand')).toBe('preset:brand')
	})

	it('canonicalizes an explicit /100 suffix to the bare reference', async () => {
		const [main] = colorField({ linked: true })
		const hook = main.hooks?.beforeValidate?.[0]
		expect(await runHook(hook, 'preset:brand/100')).toBe('preset:brand')
		expect(await runHook(hook, 'preset:brand/40')).toBe('preset:brand/40')
	})

	it('strips a reference alpha suffix when alpha is false', async () => {
		const [main] = colorField({ alpha: false, linked: true })
		const hook = main.hooks?.beforeValidate?.[0]
		expect(await runHook(hook, 'preset:brand/40')).toBe('preset:brand')
	})

	it('leaves malformed suffixes and empty references for validation to reject', async () => {
		const [main] = colorField({ linked: true })
		const hook = main.hooks?.beforeValidate?.[0]
		expect(await runHook(hook, 'preset:brand/101')).toBe('preset:brand/101')
		expect(await runHook(hook, 'preset:')).toBe('preset:')
	})

	it('normalizes to the plugin registry format when the field sets none', async () => {
		const hook = colorField().hooks?.beforeValidate?.[0]
		expect(await runHook(hook, 'red', 'oklch')).toBe('oklch(0.628 0.2577 29.23)')
	})

	it('lets a field-level format win over the plugin registry format', async () => {
		const hook = colorField({ format: 'hex' }).hooks?.beforeValidate?.[0]
		expect(await runHook(hook, 'red', 'oklch')).toBe('#ff0000')
	})

	it('defaults to hex when neither the field nor the plugin sets a format', async () => {
		const hook = colorField().hooks?.beforeValidate?.[0]
		expect(await runHook(hook, 'red')).toBe('#ff0000')
	})
})

/** Runs a field's validate with a request that translates keys to themselves. */
const runValidate = (field: { validate?: unknown }, value: unknown) =>
	(field.validate as (value: unknown, args: unknown) => Promise<string | true> | string | true)?.(
		value,
		{
			req: { payload: { config: { custom: {} } }, t: (key: string) => key },
			required: false,
			siblingData: {},
		}
	)

describe('colorField linked validation', () => {
	const presets = [
		{ key: 'brand', value: '#7c3aed' },
		{ key: 'acme/surface', value: '#f5f3ff' },
	]
	const [linked] = colorField({ linked: true, name: 'brand', presets })

	it('accepts known references with and without a valid alpha suffix', async () => {
		expect(await runValidate(linked, 'preset:brand')).toBe(true)
		expect(await runValidate(linked, 'preset:brand/40')).toBe(true)
		expect(await runValidate(linked, 'preset:brand/0')).toBe(true)
		expect(await runValidate(linked, 'preset:brand/100')).toBe(true)
		expect(await runValidate(linked, 'preset:acme/surface/40')).toBe(true)
	})

	it('keeps bare unknown references lenient for the read-time fallback flow', async () => {
		expect(await runValidate(linked, 'preset:ghost')).toBe(true)
	})

	it('flags empty keys as missing presets', async () => {
		expect(await runValidate(linked, 'preset:')).toBe('fields:missingPreset')
		expect(await runValidate(linked, 'preset:/40')).toBe('fields:missingPreset')
	})

	it('rejects a valid alpha suffix on an unknown key', async () => {
		expect(await runValidate(linked, 'preset:ghost/40')).toBe('fields:missingPreset')
	})

	it('rejects numeric-like suffixes outside the alpha grammar', async () => {
		expect(await runValidate(linked, 'preset:brand/101')).toBe('fields:invalidColor')
		expect(await runValidate(linked, 'preset:brand/4.5')).toBe('fields:invalidColor')
	})

	it('degrades the key check when the preset resolver throws', async () => {
		const [throwing] = colorField({
			linked: true,
			name: 'brand',
			presets: async () => {
				throw new Error('resolver exploded')
			},
		})
		expect(await runValidate(throwing, 'preset:ghost/40')).toBe(true)
		expect(await runValidate(throwing, 'preset:/40')).toBe('fields:missingPreset')
		expect(await runValidate(throwing, 'preset:brand/101')).toBe('fields:invalidColor')
	})
})

/** Runs a linked field's afterRead resolve hook against a stored value. */
const runResolve = (field: { hooks?: { afterRead?: FieldHook[] } }, stored: unknown) =>
	field.hooks?.afterRead?.[0]?.({
		req: { payload: { config: { custom: {} }, logger: { error: () => undefined } } },
		siblingData: { brand: stored },
	} as unknown as FieldHookArgs)

describe('colorField linked.resolve', () => {
	const presets = [
		{ key: 'flat', value: '#ffffff' },
		{ key: 'scheme', value: { dark: '#000000', light: '#ffffff' } },
	]

	it("resolve 'value' keeps a text sibling and flattens a scheme to light", async () => {
		const [, resolved] = colorField({ linked: true, name: 'brand', presets })
		expect(resolved.type).toBe('text')
		expect(await runResolve(resolved, '')).toBeNull()
		expect(await runResolve(resolved, '#123456')).toBe('#123456')
		expect(await runResolve(resolved, 'preset:flat')).toBe('#ffffff')
		expect(await runResolve(resolved, 'preset:scheme')).toBe('#ffffff')
		expect(await runResolve(resolved, 'preset:gone')).toBeNull()
	})

	it("resolve 'schemes' emits a json sibling and inflates flat values", async () => {
		const [, resolved] = colorField({ linked: { resolve: 'schemes' }, name: 'brand', presets })
		expect(resolved.type).toBe('json')
		expect(resolved.virtual).toBe(true)
		expect(resolved.name).toBe('brandResolved')
		expect(resolved.admin?.hidden).toBe(true)
		expect(resolved.admin?.disableListColumn).toBe(true)
		expect(await runResolve(resolved, '')).toBeNull()
		expect(await runResolve(resolved, '#123456')).toEqual({ dark: '#123456', light: '#123456' })
		expect(await runResolve(resolved, 'preset:flat')).toEqual({ dark: '#ffffff', light: '#ffffff' })
		expect(await runResolve(resolved, 'preset:scheme')).toEqual({
			dark: '#000000',
			light: '#ffffff',
		})
		expect(await runResolve(resolved, 'preset:gone')).toBeNull()
	})

	it('applies a string fallback in both shapes', async () => {
		const [, flat] = colorField({ linked: { fallback: '#94a3b8' }, name: 'brand', presets })
		expect(await runResolve(flat, 'preset:gone')).toBe('#94a3b8')

		const [, schemes] = colorField({
			linked: { fallback: '#94a3b8', resolve: 'schemes' },
			name: 'brand',
			presets,
		})
		expect(await runResolve(schemes, 'preset:gone')).toEqual({
			dark: '#94a3b8',
			light: '#94a3b8',
		})
	})

	it('applies a reference alpha to the resolved value in the configured format', async () => {
		const [, resolved] = colorField({ linked: true, name: 'brand', presets })
		expect(await runResolve(resolved, 'preset:flat/40')).toBe('#ffffff66')

		const [, rgbResolved] = colorField({ format: 'rgb', linked: true, name: 'brand', presets })
		expect(await runResolve(rgbResolved, 'preset:flat/40')).toBe('rgb(255 255 255 / 0.4)')
	})

	it('applies a reference alpha to both members of a schemes sibling', async () => {
		const [, resolved] = colorField({ linked: { resolve: 'schemes' }, name: 'brand', presets })
		expect(await runResolve(resolved, 'preset:scheme/40')).toEqual({
			dark: '#00000066',
			light: '#ffffff66',
		})
	})

	it('applies a reference alpha to the fallback for stale suffixed references', async () => {
		const [, resolved] = colorField({ linked: { fallback: '#94a3b8' }, name: 'brand', presets })
		expect(await runResolve(resolved, 'preset:gone/40')).toBe('#94a3b866')
	})

	it('ignores a stored suffix when alpha is disabled on the field', async () => {
		const [, resolved] = colorField({ alpha: false, linked: true, name: 'brand', presets })
		expect(await runResolve(resolved, 'preset:flat/40')).toBe('#ffffff')
	})

	it("applies a scheme fallback, flattening to light under resolve 'value'", async () => {
		const fallback = { dark: '#1e293b', light: '#94a3b8' }
		const [, flat] = colorField({ linked: { fallback }, name: 'brand', presets })
		expect(await runResolve(flat, 'preset:gone')).toBe('#94a3b8')

		const [, schemes] = colorField({
			linked: { fallback, resolve: 'schemes' },
			name: 'brand',
			presets,
		})
		expect(await runResolve(schemes, 'preset:gone')).toEqual(fallback)
	})
})
