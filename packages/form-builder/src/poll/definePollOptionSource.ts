import type { Field, Payload, PayloadRequest } from 'payload'

/** One selectable poll choice. `value` is the host's stable identifier contract: it is stored in submissions and later matched against `outcome.winningValue`, so it must never change once votes exist. */
export type PollOption = { label: string; value: string }

export type PollOptionResolveArgs<
	TConfig extends Record<string, unknown> = Record<string, unknown>,
> = {
	config: TConfig
	form: { id: number | string; title?: string }
	payload: Payload
	req?: PayloadRequest
}

/**
 * A poll option source type, authored once by the host: `config` is the admin `Field[]` an author
 * fills per form (e.g. an event id); `resolve` maps that config to the current options from host
 * domain data. Called at render time (via `resolvePollOptions`) and again at submission time, where
 * the resolved values are the only accepted answers (fail closed).
 */
export type PollOptionSource<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
	type: string
	label: string
	config?: Field[]
	resolve: (args: PollOptionResolveArgs<TConfig>) => Promise<PollOption[]> | PollOption[]
	/**
	 * Optional outcome resolver: return the winning option value from domain data (e.g. the recorded
	 * race result), or `undefined` while the outcome is not yet decidable. Enables auto mode on
	 * `resolvePollOutcome({ payload, formId })` with no explicit `winningValue`; the returned value
	 * is validated against the poll's resolved options before it is recorded, so it must be one of
	 * the values `resolve` yields.
	 */
	resolveOutcome?: (
		args: PollOptionResolveArgs<TConfig>
	) => Promise<string | undefined> | string | undefined
}

/** Erased shape stored in the registry; config re-narrows per matched type at resolution. */
export type AnyPollOptionSource = PollOptionSource<Record<string, unknown>>

export const definePollOptionSource = <
	TConfig extends Record<string, unknown> = Record<string, unknown>,
>(
	source: PollOptionSource<TConfig>
): PollOptionSource<TConfig> => source
