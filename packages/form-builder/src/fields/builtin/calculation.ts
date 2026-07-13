import type { JSONField, PayloadRequest } from 'payload'
import { normalizeCalc } from '../../calc/normalizeCalc'
import { CALC_FNS, CALC_OPS } from '../../calc/types'
import { keys } from '../../translations/keys'
import { asTranslate, labelFor } from '../../translations/server'
import { defineFormField } from '../defineFormField'

type CalcExpressionSchema = NonNullable<JSONField['jsonSchema']>

/**
 * Editor-facing JSON schema for `CalcExpression` (src/calc/types.ts), used by the admin JSON
 * field's Monaco editor for autocomplete and inline diagnostics. The real validity gate is
 * `validateExpression`/`normalizeCalc`; this schema is a convenience, not the source of truth.
 */
const calcExpressionSchema: CalcExpressionSchema = {
	uri: 'https://10xmedia.de/schemas/form-builder/calc-expression.json',
	fileMatch: ['https://10xmedia.de/schemas/form-builder/calc-expression.json'],
	schema: {
		$ref: '#/definitions/expr',
		definitions: {
			expr: {
				oneOf: [
					{ $ref: '#/definitions/lit' },
					{ $ref: '#/definitions/ref' },
					{ $ref: '#/definitions/op' },
					{ $ref: '#/definitions/neg' },
					{ $ref: '#/definitions/fn' },
					{ $ref: '#/definitions/weight' },
				],
			},
			lit: {
				type: 'object',
				properties: { type: { enum: ['lit'] }, value: { type: 'number' } },
				required: ['type', 'value'],
				additionalProperties: false,
			},
			ref: {
				type: 'object',
				properties: { type: { enum: ['ref'] }, field: { type: 'string' } },
				required: ['type', 'field'],
				additionalProperties: false,
			},
			op: {
				type: 'object',
				properties: {
					type: { enum: ['op'] },
					op: { enum: [...CALC_OPS] },
					left: { $ref: '#/definitions/expr' },
					right: { $ref: '#/definitions/expr' },
				},
				required: ['type', 'op', 'left', 'right'],
				additionalProperties: false,
			},
			neg: {
				type: 'object',
				properties: { type: { enum: ['neg'] }, operand: { $ref: '#/definitions/expr' } },
				required: ['type', 'operand'],
				additionalProperties: false,
			},
			fn: {
				type: 'object',
				properties: {
					type: { enum: ['fn'] },
					fn: { enum: [...CALC_FNS] },
					args: { type: 'array', items: { $ref: '#/definitions/expr' } },
				},
				required: ['type', 'fn', 'args'],
				additionalProperties: false,
			},
			weight: {
				type: 'object',
				properties: {
					type: { enum: ['weight'] },
					field: { type: 'string' },
					weights: { type: 'object', additionalProperties: { type: 'number' } },
				},
				required: ['type', 'field', 'weights'],
				additionalProperties: false,
			},
		},
	},
}

/**
 * Validates the calculation field's `expression`: unset/empty is fine, otherwise it must
 * normalize into a well-formed `CalcExpression` tree. Exported for unit testing.
 */
export const validateExpression = (
	value: unknown,
	{ req }: { data?: unknown; req: PayloadRequest }
): string | true => {
	if (value == null || value === '') {
		return true
	}
	return normalizeCalc(value) !== undefined
		? true
		: asTranslate(req.t)(keys.validationCalcExpressionInvalid)
}

export const calculationField = defineFormField<'number'>({
	type: 'calculation',
	label: keys.fieldTypeCalculation,
	value: 'number',
	config: [
		{
			name: 'expression',
			type: 'json',
			label: labelFor(keys.configExpression),
			admin: { description: labelFor(keys.configExpressionDescription) },
			jsonSchema: calcExpressionSchema,
			validate: validateExpression,
		},
		{
			name: 'calcDisplay',
			type: 'checkbox',
			defaultValue: true,
			label: labelFor(keys.configCalcDisplay),
		},
	],
	format: ({ value }) => (value == null ? '' : String(value)),
})
