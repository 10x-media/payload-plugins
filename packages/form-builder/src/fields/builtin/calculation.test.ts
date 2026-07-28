import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { en } from '../../translations/en'
import { keys } from '../../translations/keys'
import { calculationField, validateExpression } from './calculation'

const req = { t: (key: string) => key } as unknown as PayloadRequest

describe('validateExpression', () => {
	it('passes when unset', () => {
		expect(validateExpression(undefined, { req })).toBe(true)
		expect(validateExpression(null, { req })).toBe(true)
		expect(validateExpression('', { req })).toBe(true)
	})

	it('passes a well-formed expression tree', () => {
		const expr = {
			type: 'op',
			op: '+',
			left: { type: 'ref', field: 'qty' },
			right: { type: 'lit', value: 10 },
		}
		expect(validateExpression(expr, { req })).toBe(true)
	})

	it('fails a malformed node', () => {
		expect(validateExpression({ type: 'op', op: '+', left: { type: 'lit' } }, { req })).toBe(
			'formBuilder:validation.calcExpressionInvalid'
		)
	})

	it('fails an unknown node kind', () => {
		expect(validateExpression({ type: 'bogus' }, { req })).toBe(
			'formBuilder:validation.calcExpressionInvalid'
		)
	})

	it('fails garbage input', () => {
		expect(validateExpression('not-an-object', { req })).toBe(
			'formBuilder:validation.calcExpressionInvalid'
		)
		expect(validateExpression(42, { req })).toBe('formBuilder:validation.calcExpressionInvalid')
	})
})

type FieldWithJSONShape = {
	name: string
	jsonSchema?: { fileMatch: string[]; schema: unknown; uri: string }
	typescriptSchema?: Array<(args: { jsonSchema: unknown }) => unknown>
	admin?: {
		description?: (args: { t: (key: string, vars?: Record<string, unknown>) => string }) => string
	}
}

const expressionField = (calculationField.config as FieldWithJSONShape[]).find(
	(field) => field.name === 'expression'
)

describe('calculationField expression config', () => {
	it('carries a jsonSchema for editor autocomplete', () => {
		expect(expressionField?.jsonSchema).toBeDefined()
		expect(expressionField?.jsonSchema?.uri).toContain('calc-expression.json')
		expect(expressionField?.jsonSchema?.fileMatch).toEqual([expressionField?.jsonSchema?.uri])
	})

	it('gives type generation a flat, $ref-free schema via typescriptSchema', () => {
		const overrides = expressionField?.typescriptSchema
		expect(overrides).toHaveLength(1)
		const generated = overrides?.[0]?.({ jsonSchema: expressionField?.jsonSchema?.schema })
		expect(generated).toEqual({ type: 'object' })
		expect(JSON.stringify(generated)).not.toContain('$ref')
	})

	it('renders the description through Payload-style t()', () => {
		const translations: Record<string, string> = {
			[keys.configExpressionDescription]: en[keys.configExpressionDescription],
		}
		const fakeT = (key: string): string => translations[key] ?? key

		const rendered = expressionField?.admin?.description?.({ t: fakeT })
		expect(rendered).toBe(en[keys.configExpressionDescription])
	})

	it('mounts the visual expression builder with the description key', () => {
		const admin = expressionField?.admin as
			| { components?: { Field?: { path?: string; clientProps?: Record<string, unknown> } } }
			| undefined
		expect(admin?.components?.Field?.path).toBe(
			'@10x-media/form-builder/client#CalcExpressionBuilder'
		)
		expect(admin?.components?.Field?.clientProps).toEqual({
			descriptionKey: keys.configExpressionDescription,
		})
	})
})
