import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import {
	buildCalculationField,
	buildValidateExpression,
	calculationField,
	validateExpression,
} from './calculation'

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
	admin?: { components?: { Field?: unknown }; description?: unknown }
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

	it('mounts the visual expression builder without a field description', () => {
		expect(expressionField?.admin?.components?.Field).toBe(
			'@10x-media/form-builder/client#CalcExpressionBuilder'
		)
		expect(expressionField?.admin?.description).toBeUndefined()
	})
})

describe('buildValidateExpression with allowed extensions', () => {
	const allowed = { sources: new Set(['taxRate']), functions: new Set(['double']) }
	const validate = buildValidateExpression(allowed)

	it('accepts source nodes and custom fns in the allowed sets', () => {
		expect(validate({ type: 'source', source: 'taxRate' }, { req })).toBe(true)
		expect(validate({ type: 'fn', fn: 'double', args: [{ type: 'lit', value: 1 }] }, { req })).toBe(
			true
		)
	})

	it('still rejects unregistered keys', () => {
		expect(validate({ type: 'source', source: 'unknown' }, { req })).toBe(
			'formBuilder:validation.calcExpressionInvalid'
		)
	})

	it('the no-extensions validateExpression rejects source nodes', () => {
		expect(validateExpression({ type: 'source', source: 'taxRate' }, { req })).toBe(
			'formBuilder:validation.calcExpressionInvalid'
		)
	})
})

describe('buildCalculationField', () => {
	it('threads the allowed sets into the expression validate', () => {
		const field = buildCalculationField({ sources: new Set(['taxRate']), functions: new Set() })
		const expression = (field.config as FieldWithJSONShape[]).find(
			(entry) => entry.name === 'expression'
		) as { validate?: (value: unknown, args: { req: PayloadRequest }) => string | true }
		expect(expression?.validate?.({ type: 'source', source: 'taxRate' }, { req })).toBe(true)
	})

	it('the no-extensions calculationField equals buildCalculationField()', () => {
		expect(calculationField.type).toBe('calculation')
		const expression = (buildCalculationField().config as FieldWithJSONShape[]).find(
			(entry) => entry.name === 'expression'
		) as { validate?: (value: unknown, args: { req: PayloadRequest }) => string | true }
		expect(expression?.validate?.({ type: 'source', source: 'taxRate' }, { req })).toBe(
			'formBuilder:validation.calcExpressionInvalid'
		)
	})
})
