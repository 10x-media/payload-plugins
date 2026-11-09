import type { PayloadRequest } from 'payload'
import { formatCalcValue } from '../../calc/formatCalcValue'
import { type CalcAllowed, normalizeCalc } from '../../calc/normalizeCalc'
import { keys } from '../../translations/keys'
import { asTranslate, labelFor } from '../../translations/server'
import { defineFormField } from '../defineFormField'
import { localizedIf } from '../localizedIf'

/**
 * Serializable calc-source metadata for the admin builder (threaded as clientProps): key, display
 * label, and which modes the source implements (`scalar` = has `resolve`, `weights` = has
 * `resolveWeights`). Derived where the registry is resolved; resolver functions never serialize.
 */
export type CalcSourceClientMeta = {
	key: string
	label: string | Record<string, string>
	scalar: boolean
	weights: boolean
}

type BuildCalculationFieldExtras = {
	/** Whether content-bearing display config (`prefix`, `suffix`) is localized. */
	localize?: boolean
	/** Registered calc-source metadata for the builder UI. */
	sources?: CalcSourceClientMeta[]
}

/** The calculation field's own config values (display settings; `expression` is handled separately). */
type CalculationConfig = {
	decimals?: number
	prefix?: string
	suffix?: string
}

const CALC_SCHEMA_URI = 'https://10xmedia.de/schemas/form-builder/calc-expression.json'

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
 * (plugin option `calc`) into the expression validate; `extras.sources`
 * carries serializable source metadata to the builder component as clientProps (custom function
 * names travel too, so the client-side normalize accepts every expression the server accepts).
 */
export const buildCalculationField = (
	allowed?: CalcAllowed,
	extras?: BuildCalculationFieldExtras
) => {
	const sources = extras?.sources ?? []
	const functions = [...(allowed?.functions ?? [])]
	const builderRef = '@10x-media/form-builder/client#CalcExpressionBuilder'
	return defineFormField<'number', CalculationConfig>({
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
					components: {
						Field:
							sources.length > 0 || functions.length > 0
								? { path: builderRef, clientProps: { sources, functions } }
								: builderRef,
					},
				},
				// Type generation reads jsonSchema.schema as the field's type (Payload 4 has no transform
				// for json fields), and the visual builder replaces the JSON editor, so a flat object is
				// all it carries. The real gate is the validate below.
				jsonSchema: {
					uri: CALC_SCHEMA_URI,
					fileMatch: [CALC_SCHEMA_URI],
					schema: { type: 'object' },
				},
				validate: buildValidateExpression(allowed),
			},
			{
				name: 'calcDisplay',
				type: 'checkbox',
				defaultValue: true,
				label: labelFor(keys.configCalcDisplay),
			},
			{
				name: 'decimals',
				type: 'number',
				min: 0,
				max: 6,
				label: labelFor(keys.calcConfigDecimals),
			},
			{
				name: 'prefix',
				type: 'text',
				label: labelFor(keys.calcConfigPrefix),
				...localizedIf(extras?.localize === true),
			},
			{
				name: 'suffix',
				type: 'text',
				label: labelFor(keys.calcConfigSuffix),
				...localizedIf(extras?.localize === true),
			},
		],
		format: ({ value, config }) => (value == null ? '' : formatCalcValue(value, config)),
	})
}

/** The no-extensions definition, for definition-spread consumers (the `buildSelectField`/`selectField` precedent). */
export const calculationField = buildCalculationField()
