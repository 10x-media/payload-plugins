import type { Payload, PayloadRequest } from 'payload'
import type { RichTextBodyOption } from './body/serializeBody'
import type { ActionRegistry } from './registry'
import type { ActionInstance } from './runActions'
import { ACTIONS_TASK_SLUG, runActionsForSubmission } from './task'

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
 * error is swallowed (logged via `payload.logger`). Never rejects.
 */
export const dispatchActions = async (args: DispatchActionsArgs): Promise<void> => {
	const { payload, registry, req, formId, submissionId } = args
	const actions = args.actions ?? []
	// Nothing to run and nothing to prune: skip. An action-less form that opted out of persistence still
	// runs the completion below, so `runActionsForSubmission` can delete the row out of band.
	if (actions.length === 0 && args.persistSubmissions !== false) {
		return
	}

	if (args.hasRunner && canQueue(payload)) {
		try {
			await payload.jobs.queue({
				task: ACTIONS_TASK_SLUG,
				input: { formId: String(formId), submissionId: String(submissionId) },
				req,
			})
		} catch (error) {
			payload.logger?.error(
				`@10x-media/form-builder: failed to enqueue actions for submission ${String(submissionId)}: ${
					error instanceof Error ? error.message : String(error)
				}`
			)
		}
		return
	}

	const ms = args.deadlineMs ?? INLINE_DISPATCH_DEADLINE_MS
	// Guard the action arm itself (not just the race) so a rejection AFTER the deadline wins is never an unhandled rejection.
	const work = runActionsForSubmission({
		input: { formId, submissionId },
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
}
