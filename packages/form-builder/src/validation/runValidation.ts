import type { Payload, PayloadRequest } from 'payload'
import type { AnyFormFieldDefinition, Translate } from '../fields/types'
import type { FormFieldInstance } from '../submissions/types'
import { keys } from '../translations/keys'
import { resolveMessage, withTimeout } from './message'
import type { ValidationRuleRegistry } from './registry'
import type { MessageFn, ValidationRuleResult, ValidationSeverity } from './types'

const RULE_TIMEOUT_MS = 5000

export type ValidationIssue = { message: string; severity: ValidationSeverity }

export type RunValidationInput = {
	field: FormFieldInstance
	fieldDefinition?: AnyFormFieldDefinition
	value: unknown
	fieldType: string
	ruleRegistry: ValidationRuleRegistry
	answers: Record<string, unknown>
	locale: string
	t: Translate
	operation: 'create' | 'update'
	event: 'onChange' | 'submit'
	mode: 'client' | 'server'
	req?: PayloadRequest
	payload?: Payload
	formId?: number | string
	/** Override the per-rule timeout in ms. Defaults to RULE_TIMEOUT_MS; primarily for tests. */
	timeoutMs?: number
}

export type RunValidationResult = { errors: ValidationIssue[] }

const isEmpty = (value: unknown): boolean =>
	value == null || value === '' || (Array.isArray(value) && value.length === 0)

type RuleInstance = { blockType: string; message?: string; severity?: ValidationSeverity } & Record<
	string,
	unknown
>

/** Build the per-instance message resolver: custom override (a literal template) or the localized default. */
const makeMessage = (
	instance: RuleInstance,
	defaultMessageKey: string,
	t: Translate
): MessageFn => {
	const { blockType: _blockType, message: _message, severity: _severity, ...params } = instance
	const template =
		typeof instance.message === 'string' && instance.message.length > 0
			? instance.message
			: t(defaultMessageKey)
	return (vars = {}) => resolveMessage(template, { ...params, ...vars })
}

const toIssue = (
	result: ValidationRuleResult,
	fallbackSeverity: ValidationSeverity
): ValidationIssue | null => {
	if (result === true) {
		return null
	}
	if (typeof result === 'string') {
		return { message: result, severity: fallbackSeverity }
	}
	return { message: result.message, severity: result.severity ?? fallbackSeverity }
}

/**
 * The one validation engine, run per field on client and server. Order: required, the field type's
 * intrinsic validator, then each declarative rule instance. Server-only rules are skipped in client
 * mode; every rule is wrapped in try/catch + a timeout so a bad rule cannot crash or stall the submit
 * path (a thrown or timed-out rule fails open, logged on the server). Only `error`-severity issues
 * block submission; the caller filters severity.
 */
export const runValidation = async (input: RunValidationInput): Promise<RunValidationResult> => {
	const {
		field,
		fieldDefinition,
		value,
		fieldType,
		ruleRegistry,
		answers,
		locale,
		t,
		operation,
		event,
		mode,
		req,
		payload,
		formId,
		timeoutMs,
	} = input
	const timeout = timeoutMs ?? RULE_TIMEOUT_MS
	const errors: ValidationIssue[] = []

	if (field.required && isEmpty(value)) {
		return { errors: [{ message: t(keys.validationRequired), severity: 'error' }] }
	}
	// Repeaters coerced to [] must reach fieldDefinition.validate so minRows is enforced;
	// all other empty fields have no intrinsic rules to run.
	if (isEmpty(value) && field.blockType !== 'repeater') {
		return { errors: [] }
	}

	if (fieldDefinition?.validate) {
		try {
			const ran = fieldDefinition.validate({
				value,
				config: field,
				siblingData: answers,
				data: answers,
				locale,
				t,
			})
			const result = ran instanceof Promise ? await withTimeout(ran, timeout, true) : ran
			if (result !== true) {
				errors.push({ message: result, severity: 'error' })
			}
		} catch (error) {
			req?.payload?.logger?.error?.(
				{ err: error, field: field.name },
				'form-builder intrinsic field validator threw'
			)
		}
	}

	if (fieldDefinition?.schema) {
		try {
			const outcome = await fieldDefinition.schema['~standard'].validate(value)
			if (outcome.issues) {
				for (const issue of outcome.issues) {
					errors.push({ message: issue.message, severity: 'error' })
				}
			}
		} catch (error) {
			req?.payload?.logger?.error?.(
				{ err: error, field: field.name },
				'form-builder field schema threw'
			)
		}
	}

	const instances = (Array.isArray(field.validations) ? field.validations : []) as RuleInstance[]
	for (const instance of instances) {
		const rule = ruleRegistry.get(instance.blockType)
		if (!rule) {
			continue
		}
		if (mode === 'client' && rule.client === false) {
			continue
		}
		const message = makeMessage(instance, rule.defaultMessage, t)
		const fallbackSeverity: ValidationSeverity = instance.severity ?? rule.severity ?? 'error'
		try {
			const ran = rule.validate({
				value,
				params: instance,
				siblingData: answers,
				data: answers,
				field,
				fieldType,
				operation,
				event,
				locale,
				message,
				req: mode === 'server' ? req : undefined,
				payload: mode === 'server' ? payload : undefined,
				formId: mode === 'server' ? formId : undefined,
			})
			const result = ran instanceof Promise ? await withTimeout(ran, timeout, true) : ran
			const issue = toIssue(result, fallbackSeverity)
			if (issue) {
				errors.push(issue)
			}
		} catch (error) {
			req?.payload?.logger?.error?.(
				{ err: error, rule: rule.type },
				'form-builder validation rule threw'
			)
		}
	}

	return { errors }
}
