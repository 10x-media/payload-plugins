import type { Field, Payload, PayloadRequest } from 'payload'
import type { Translate } from '../fields/types'
import type { SubmissionDescriptor, SubmissionValue } from '../submissions/types'

/** Context passed to an action's `run` when a submission completes. */
export type ActionRunArgs<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
	form: { id: number | string; title?: string }
	submissionId: number | string
	values: SubmissionValue[]
	descriptors: SubmissionDescriptor[]
	config: TConfig
	payload: Payload
	req?: PayloadRequest
	locale: string
	t: Translate
	/** Serialize a rich text (or legacy string) body config into channel-ready HTML. */
	renderBody: (body: unknown) => Promise<string>
}

/**
 * A post-submit action type, authored once: `config` is the admin `Field[]` for authoring;
 * `run` executes when a submission completes. Built-ins use this same primitive.
 */
export type ActionDefinition<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
	type: string
	label: string
	config?: Field[]
	run: (args: ActionRunArgs<TConfig>) => Promise<void> | void
}

/** Erased shape stored in the registry; config re-narrows per matched type at execution. */
export type AnyActionDefinition = ActionDefinition<Record<string, unknown>>

export const defineAction = <TConfig extends Record<string, unknown> = Record<string, unknown>>(
	definition: ActionDefinition<TConfig>
): ActionDefinition<TConfig> => definition
