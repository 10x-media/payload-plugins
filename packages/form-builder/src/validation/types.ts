import type { Field, Payload, PayloadRequest } from 'payload'
import type { FormFieldInstance } from '../submissions/types'

export type ValidationSeverity = 'error' | 'warning'

/** A rule outcome: pass, a plain error string, or an explicit message + severity. */
export type ValidationRuleResult =
	| true
	| string
	| { message: string; severity?: ValidationSeverity }

/** Resolves this rule instance's message (custom override or localized default) with `{var}` interpolation. */
export type MessageFn = (vars?: Record<string, unknown>) => string

/** Resolved per-instance rule params (loose at the DB boundary, narrowed by the author's generic). */
export type ValidationParams = Record<string, unknown>

export type ValidationRuleValidateArgs<
	TParams extends ValidationParams,
	TValue,
	TData extends Record<string, unknown> = Record<string, unknown>,
> = {
	value: TValue | null | undefined
	params: TParams
	siblingData: TData
	data: TData
	field: FormFieldInstance
	fieldType: string
	operation: 'create' | 'update'
	event: 'onChange' | 'submit'
	locale: string
	message: MessageFn
	/** Server only. Absent in the client (req-less) context, so a server-only rule cannot run there. */
	req?: PayloadRequest
	payload?: Payload
	/** Server only. The form being submitted, for form-scoped lookups (e.g. notAlreadySubmitted). */
	formId?: number | string
}

export type ValidationRuleValidate<
	TParams extends ValidationParams,
	TValue,
	TData extends Record<string, unknown> = Record<string, unknown>,
> = (
	args: ValidationRuleValidateArgs<TParams, TValue, TData>
) => Promise<ValidationRuleResult> | ValidationRuleResult

/**
 * A validation rule type, authored once. `params` is a Payload `Field[]` rendered in the per-field
 * constraint list; `validate` returns `true | string | { message, severity }`. `client` defaults from
 * whether the rule is pure (a rule that is async or uses `req`/`payload` must set `client: false`).
 */
export type ValidationRuleDefinition<
	TParams extends ValidationParams = ValidationParams,
	TValue = unknown,
	TData extends Record<string, unknown> = Record<string, unknown>,
> = {
	type: string
	label: string
	description?: string
	/** Field type slugs this rule may be added to. Omit for all field types. */
	appliesTo?: string[]
	params?: Field[]
	defaultMessage: string
	/** Runs client-side too. Defaults to `true`; set `false` for async or `req`/`payload`-using rules. */
	client?: boolean
	/** Default severity when `validate` returns a bare string. Defaults to `error`. */
	severity?: ValidationSeverity
	validate: ValidationRuleValidate<TParams, TValue, TData>
}

/** Erased shape stored in the heterogeneous registry; params re-narrow per matched rule at execution. */
export type AnyValidationRuleValidate = (args: {
	value: unknown
	params: ValidationParams
	siblingData: Record<string, unknown>
	data: Record<string, unknown>
	field: FormFieldInstance
	fieldType: string
	operation: 'create' | 'update'
	event: 'onChange' | 'submit'
	locale: string
	message: MessageFn
	req?: PayloadRequest
	payload?: Payload
	formId?: number | string
}) => Promise<ValidationRuleResult> | ValidationRuleResult

export type AnyValidationRuleDefinition = {
	type: string
	label: string
	description?: string
	appliesTo?: string[]
	params?: Field[]
	defaultMessage: string
	client?: boolean
	severity?: ValidationSeverity
	validate: AnyValidationRuleValidate
}
