import type { FieldHookArgs } from 'payload'
import { describe, expect, it } from 'vitest'
import { colorField } from './colorField'

type ComponentsShape = {
	Cell: { path: string }
	Field: { clientProps: Record<string, unknown>; path: string }
}

const components = (field: { admin?: { components?: unknown } }): ComponentsShape =>
	field.admin?.components as ComponentsShape

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
		const normalized = await hook?.({ value: 'red' } as unknown as FieldHookArgs)
		expect(normalized).toBe('rgb(255 0 0)')
		const untouched = await hook?.({ value: 'not-a-color' } as unknown as FieldHookArgs)
		expect(untouched).toBe('not-a-color')
	})

	it('strips alpha during normalization when alpha is false', async () => {
		const field = colorField({ alpha: false })
		const hook = field.hooks?.beforeValidate?.[0]
		const normalized = await hook?.({ value: '#ff000080' } as unknown as FieldHookArgs)
		expect(normalized).toBe('#ff0000')
	})

	it('passes preset references through normalization untouched in linked mode', async () => {
		const [main] = colorField({ linked: true })
		const hook = main.hooks?.beforeValidate?.[0]
		const out = await hook?.({ value: 'preset:brand' } as unknown as FieldHookArgs)
		expect(out).toBe('preset:brand')
	})
})
