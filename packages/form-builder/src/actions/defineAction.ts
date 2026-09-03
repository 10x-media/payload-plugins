import type { Field, Payload, PayloadRequest } from 'payload'
import type { FormContextReference } from '../context/formContext'
import type { Translate } from '../fields/types'
import type { SubmissionDescriptor, SubmissionValue } from '../submissions/types'

/** Context passed to an action's `run` when a submission completes. */
export type ActionRunArgs<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
	form: { id: number | string; title?: string }
	submissionId: number | string
	values: SubmissionValue[]
	descriptors: SubmissionDescriptor[]
	/** The verified form-context reference the submission was made through, or null when it had none. */
	context: FormContextReference | null
	config: TConfig
	payload: Payload
	req?: PayloadRequest
	locale: string
	t: Translate
	/** Serialize a rich text (or legacy string) body config into channel-ready HTML. */
	renderBody: (body: unknown) => Promise<string>
}

/** Context passed to an action's `validateConfig` when a form carrying it is saved. */
export type ActionValidateArgs = {
	/** The whole form data under validation, merged over the stored doc on partial updates. */
	data: Record<string, unknown>
	req: PayloadRequest
}

/**
 * Throw from an action's `run` to attach structured context (a status code, a provider response)
 * to the failed `ActionResult` without concatenating it into the message. The plugin logs `detail`
 * alongside the failure; any thrown error carrying a `detail` property is treated the same.
 */
export class ActionError extends Error {
	detail?: unknown

	constructor(message: string, detail?: unknown) {
		super(message)
		this.name = 'ActionError'
		this.detail = detail
	}
}

/**
 * A post-submit action type, authored once: `config` is the admin `Field[]` for authoring;
 * `run` executes when a submission completes. Built-ins use this same primitive.
 */
export type ActionDefinition<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
	type: string
	/** i18n-key or literal (resolved like a field label), or a per-locale record. */
	label: string | Record<string, string>
	config?: Field[]
	/**
	 * This action's failure is the submission's failure: it runs inline before the response (never
	 * queued, bounded by the dispatch deadline), a throw or timeout turns the submit into an error
	 * the visitor sees, the remaining actions are skipped, and the submission is kept even on a
	 * `persistSubmissions: false` form so what the visitor sent is never lost. For an action that
	 * IS the point of the submission (a signup provider that is the system of record); leave unset
	 * for notifications and other fire-and-forget work.
	 */
	essential?: boolean
	/**
	 * Cross-field check over one stored instance of this action, run alongside field validation on
	 * every form save. Return `true` to accept or an error message to refuse; the message is
	 * attached to the action block (`actions.<index>`) rather than to any one config field, which
	 * per-field `validate` cannot express (an optional array's `validate` never runs on the empty
	 * array, the case a "template token has no mapping" check cares about most).
	 */
	validateConfig?: (
		config: TConfig,
		ctx: ActionValidateArgs
	) => string | true | Promise<string | true>
	run: (args: ActionRunArgs<TConfig>) => Promise<void> | void
}

/** Erased shape stored in the registry; config re-narrows per matched type at execution. */
export type AnyActionDefinition = ActionDefinition<Record<string, unknown>>

export const defineAction = <TConfig extends Record<string, unknown> = Record<string, unknown>>(
	definition: ActionDefinition<TConfig>
): ActionDefinition<TConfig> => definition
