import type { PayloadRequest } from 'payload'
import { fieldNamesOfType } from '../fields/fieldNamesOfType'
import type { FieldTypeRegistry } from '../fields/registry'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'

/** Slugs of registered field types choosable as a poll's results field (`pollEligible: true`). */
export const pollEligibleTypes = (registry: FieldTypeRegistry): string[] =>
	[...registry.values()]
		.filter((definition) => definition.pollEligible === true)
		.map((definition) => definition.type)

/**
 * Validate for `poll.resultsField`, closed over the eligible type slugs derived from the registry
 * at collection-build time (mirrors the confirmation action's `toField`): unset is fine, otherwise
 * the value must name an existing, named field instance whose type is poll-eligible. Payload skips
 * the validate while the poll is disabled (the field's `admin.condition`), so a stale reference on
 * a disabled poll never blocks a save.
 */
export const buildValidateResultsField =
	(eligibleTypes: readonly string[]) =>
	(value: unknown, { data, req }: { data?: unknown; req: PayloadRequest }): string | true => {
		if (typeof value !== 'string' || value.length === 0) {
			return true
		}
		const fields =
			data && typeof data === 'object' ? (data as Record<string, unknown>).fields : undefined
		return fieldNamesOfType(fields, eligibleTypes).includes(value)
			? true
			: asTranslate(req.t)(keys.validationResultsFieldUnknown)
	}
