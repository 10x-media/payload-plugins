import type { PayloadRequest, Validate } from 'payload'
import {
	checkbox,
	code,
	date,
	email,
	json,
	number,
	point,
	radio,
	select,
	text,
	textarea,
} from 'payload/shared'
import type { EncryptedSourceField, EncryptedSourceType } from './types'

/**
 * Erasure signature at the stock-validator boundary. Payload types each
 * validator against its own field config; we dispatch by source type at
 * runtime, so the per-type generics are intentionally widened here.
 */
export type PlaintextValidator = (
	value: unknown,
	options: Record<string, unknown> & { req: PayloadRequest }
) => Promise<string | true> | string | true

const stockValidators: Partial<Record<EncryptedSourceType, unknown>> = {
	checkbox,
	code,
	date,
	email,
	json,
	number,
	point,
	radio,
	select,
	text,
	textarea,
}

/**
 * The validator that must see PLAINTEXT: the user's own validate when given,
 * else the stock validator matching the ORIGINAL field type with the original
 * constraints (required, options, hasMany, min/max, ...) overlaid onto the
 * options Payload builds for the text-backed stored field.
 *
 * richText: payload/shared's richText validator calls the resolved editor,
 * which a text-backed field does not have; enforce required only.
 */
export const makeEffectiveValidator = (source: EncryptedSourceField): PlaintextValidator => {
	const userValidate = 'validate' in source ? source.validate : undefined
	if (typeof userValidate === 'function') {
		return userValidate as PlaintextValidator
	}
	if (source.type === 'richText') {
		return (value, options) => {
			if ('required' in source && source.required === true && value == null) {
				return options.req.t('validation:required')
			}
			return true
		}
	}
	const stock = stockValidators[source.type] as PlaintextValidator
	return (value, options) => stock(value, { ...options, ...(source as Record<string, unknown>) })
}

const isSealedString = (value: unknown): boolean =>
	typeof value === 'string' && value.startsWith('pfe1.') && value.split('.').length === 5

/**
 * The stored field's validate. Sealed values already passed plaintext
 * validation inside the seal hook (field beforeChange hooks run BEFORE
 * validate in Payload's traversal); unchanged fields on update arrive here
 * sealed from the merged document. Everything else (admin form state, null,
 * undefined/required, lazy-migration plaintext) delegates to the effective
 * validator.
 */
export const makeComposedValidate = (effective: PlaintextValidator, hasMany: boolean): Validate => {
	const sealedShape = (value: unknown): boolean => {
		if (hasMany) {
			return Array.isArray(value) && value.length > 0 && value.every(isSealedString)
		}
		return isSealedString(value)
	}
	return (value, options) => {
		if (value != null && sealedShape(value)) {
			return true
		}
		return effective(value, options as Record<string, unknown> & { req: PayloadRequest })
	}
}
