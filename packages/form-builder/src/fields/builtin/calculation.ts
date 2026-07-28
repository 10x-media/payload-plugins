import type { JSONField, PayloadRequest } from 'payload'
import { type CalcAllowed, normalizeCalc } from '../../calc/normalizeCalc'
import { CALC_FNS, CALC_OPS } from '../../calc/types'
import { keys } from '../../translations/keys'
import { asTranslate, labelFor } from '../../translations/server'
import { defineFormField } from '../defineFormField'

type CalcExpressionSchema = NonNullable<JSONField['jsonSchema']>

/**
 * Editor-facing JSON schema for `CalcExpression` (src/calc/types.ts), used by the admin JSON
 * field's Monaco editor for autocomplete and inline diagnostics. Built per boot so registered
 * extension names (custom functions, source keys) autocomplete too. The real validity gate is
 * `buildValidateExpression`/`normalizeCalc`; this schema is a convenience, not the source of truth.
 */
const buildCalcExpressionSchema = (allowed?: CalcAllowed): CalcExpressionSchema => {
	const sourceKeys = [...(allowed?.sources ?? [])]
	const fnNames = [...CALC_FNS, ...(allowed?.functions ?? [])]
	return {
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
						...(sourceKeys.length > 0 ? [{ $ref: '#/definitions/source' }] : []),
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
						fn: { enum: fnNames },
						args: { type: 'array', items: { $ref: '#/definitions/expr' } },
					},
					required: ['type', 'fn', 'args'],
					additionalProperties: false,
				},
				...(sourceKeys.length > 0
					? {
							source: {
								type: 'object',
								properties: { type: { enum: ['source'] }, source: { enum: sourceKeys } },
								required: ['type', 'source'],
								additionalProperties: false,
							},
						}
					: {}),
				weight: {
					type: 'object',
					properties: {
						type: { enum: ['weight'] },
						field: { type: 'string' },
						weights: { type: 'object', additionalProperties: { type: 'number' } },
						...(sourceKeys.length > 0 ? { source: { enum: sourceKeys } } : {}),
					},
					// With sources registered a weight may carry `source` instead of inline weights; the
					// either-or itself is enforced by normalizeCalc, not this convenience schema.
					required: sourceKeys.length > 0 ? ['type', 'field'] : ['type', 'field', 'weights'],
					additionalProperties: false,
				},
			},
		},
	}
}

/**
 * Validates the calculation field's `expression` against the registered extension names: unset/empty
 * is fine, otherwise it must normalize into a well-formed `CalcExpression` tree.
 */
export const buildValidateExpression =
	(allowed?: CalcAllowed) =>
	(value: unknown, { req }: { data?: unknown; req: PayloadRequest }): string | true => {
		if (value == null || value === '') {
			return true
		}
		return normalizeCalc(value, allowed) !== undefined
			? true
			: asTranslate(req.t)(keys.validationCalcExpressionInvalid)
	}

/** The no-extensions validate (built-in grammar only). Exported for unit testing and spread consumers. */
export const validateExpression = buildValidateExpression()

/**
 * A calculation is derived and read-only: it renders disabled with no text affordance (no
 * `placeholder`), and it is never validated (`runSubmission` stores its computed value and skips
 * `runValidation` entirely), so an authored `required` could never fire. Both are omitted rather
 * than offered as settings that do nothing. `allowed` threads the registered calc extension names
 * (plugin option `calc`) into the expression validate and the editor schema.
 */
export const buildCalculationField = (allowed?: CalcAllowed) =>
	defineFormField<'number'>({
		type: 'calculation',
		label: keys.fieldTypeCalculation,
		value: 'number',
		omitShared: ['placeholder', 'required'],
		config: [
			{
				name: 'expression',
				type: 'json',
				label: labelFor(keys.configExpression),
				admin: {
					components: { Field: '@10x-media/form-builder/client#CalcExpressionBuilder' },
				},
				jsonSchema: buildCalcExpressionSchema(allowed),
				// generate:types embeds jsonSchema.schema into the config-level schema, where its
				// document-root-relative $refs cannot resolve; hand type generation a flat shape instead.
				typescriptSchema: [() => ({ type: 'object' })],
				validate: buildValidateExpression(allowed),
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

/** The no-extensions definition, for definition-spread consumers (the `buildSelectField`/`selectField` precedent). */
export const calculationField = buildCalculationField()
