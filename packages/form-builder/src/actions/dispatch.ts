import type { Payload, PayloadRequest } from 'payload'
import type { RichTextBodyOption } from './body/serializeBody'
import { ESSENTIAL_ACTION_FAILED_CONTEXT_KEY } from './dispatchContext'
import { type ActionRegistry, isEssentialAction } from './registry'
import type { ActionInstance } from './runActions'
import { ACTIONS_TASK_SLUG, runActionsForSubmission } from './task'

export { ESSENTIAL_ACTION_FAILED_CONTEXT_KEY }

/** Default cap on inline action work so a missing worker never hangs the submission response. */
export const INLINE_DISPATCH_DEADLINE_MS = 5_000

export type DispatchActionsArgs = {
	actions: ActionInstance[] | null | undefined
	formId: number | string
	submissionId: number | string
	registry: ActionRegistry
	payload: Payload
	req?: PayloadRequest
	/** Whether a job runner is likely present (queued path); otherwise the bounded-inline fallback runs. */
	hasRunner: boolean
	/** The owning form's `persistSubmissions`; when explicitly `false`, run the completion even with no actions so the row is pruned. */
	persistSubmissions?: boolean
	deadlineMs?: number
	richText?: RichTextBodyOption
}

const canQueue = (payload: Payload): boolean => typeof payload.jobs?.queue === 'function'

const deadline = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		const timer = setTimeout(resolve, ms)
		timer.unref?.()
	})

/**
 * Dispatch a submission's post-submit actions without throwing and without blocking the response on slow
 * action work. With no actions, returns immediately. When a job runner is present, enqueues the native
 * `form-builder-actions` task and returns (action work happens out of band). Otherwise runs the actions
 * inline but bounded by a deadline so a missing worker still delivers without hanging the request; any
 * error is swallowed (logged via `payload.logger`). Never rejects; the return reports whether an
 * essential pass failed, so the caller can withhold success signals (the created event, the 201).
 */
export const dispatchActions = async (
	args: DispatchActionsArgs
): Promise<{ essentialFailed: boolean }> => {
	const { payload, registry, req, formId, submissionId } = args
	const actions = args.actions ?? []
	const hasEssential = actions.some((instance) => isEssentialAction(registry, instance))

	// Essential actions run first, inline and awaited, never queued: their failure is the
	// submission's failure, which the submit endpoint turns into an error response via the context
	// flag. On failure the remaining actions are skipped and so is the pruning completion, so a
	// `persistSubmissions: false` form keeps the row: the provider never received it, and the
	// stored copy is the only record of what the visitor sent.
	if (hasEssential) {
		const ms = args.deadlineMs ?? INLINE_DISPATCH_DEADLINE_MS
		const work = runActionsForSubmission({
			input: { formId, submissionId, subset: 'essential' },
			registry,
			payload,
			req,
			richText: args.richText,
		}).then(
			(results) => ({ timedOut: false, failed: results.some((result) => !result.ok) }),
			(error) => {
				payload.logger?.error(
					`@10x-media/form-builder: essential action pass for submission ${String(submissionId)} threw: ${
						error instanceof Error ? error.message : String(error)
					}`
				)
				return { timedOut: false, failed: true }
			}
		)
		const outcome = await Promise.race([
			work,
			deadline(ms).then(() => ({ timedOut: true, failed: true })),
		])
		if (outcome.failed) {
			if (outcome.timedOut) {
				payload.logger?.error(
					`@10x-media/form-builder: essential action pass for submission ${String(submissionId)} outlived its ${ms}ms deadline; treating the submission as failed (the work may still complete)`
				)
			}
			if (req) {
				req.context = { ...(req.context ?? {}), [ESSENTIAL_ACTION_FAILED_CONTEXT_KEY]: true }
			}
			return { essentialFailed: true }
		}
	}

	// Nothing to run and nothing to prune: skip. An action-less form that opted out of persistence still
	// runs the completion below, so `runActionsForSubmission` can delete the row out of band.
	const rest = hasEssential
		? actions.filter((instance) => !isEssentialAction(registry, instance))
		: actions
	if (rest.length === 0 && args.persistSubmissions !== false) {
		return { essentialFailed: false }
	}

	// With an essential pass already run, the closing pass covers only the rest (subset threading
	// keeps the queued task from re-running the essential actions).
	const subset = hasEssential ? ({ subset: 'rest' } as const) : {}

	if (args.hasRunner && canQueue(payload)) {
		try {
			await payload.jobs.queue({
				task: ACTIONS_TASK_SLUG,
				input: { formId: String(formId), submissionId: String(submissionId), ...subset },
				req,
			})
		} catch (error) {
			payload.logger?.error(
				`@10x-media/form-builder: failed to enqueue actions for submission ${String(submissionId)}: ${
					error instanceof Error ? error.message : String(error)
				}`
			)
		}
		return { essentialFailed: false }
	}

	const ms = args.deadlineMs ?? INLINE_DISPATCH_DEADLINE_MS
	// Guard the action arm itself (not just the race) so a rejection AFTER the deadline wins is never an unhandled rejection.
	const work = runActionsForSubmission({
		input: { formId, submissionId, ...subset },
		registry,
		payload,
		req,
		richText: args.richText,
	}).catch((error) => {
		payload.logger?.error(
			`@10x-media/form-builder: inline action dispatch for submission ${String(submissionId)} threw: ${
				error instanceof Error ? error.message : String(error)
			}`
		)
	})
	await Promise.race([work, deadline(ms)])
	return { essentialFailed: false }
}
