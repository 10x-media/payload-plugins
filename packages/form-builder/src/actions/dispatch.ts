import type { Payload, PayloadRequest } from 'payload'
import type { RichTextBodyOption } from './body/serializeBody'
import {
	ESSENTIAL_ACTION_FAILED_CONTEXT_KEY,
	ESSENTIAL_ACTION_UNCERTAIN_CONTEXT_KEY,
} from './dispatchContext'
import { type ActionRegistry, isEssentialAction } from './registry'
import type { ActionInstance } from './runActions'
import { ACTIONS_TASK_SLUG, runActionsForSubmission } from './task'

export { ESSENTIAL_ACTION_FAILED_CONTEXT_KEY, ESSENTIAL_ACTION_UNCERTAIN_CONTEXT_KEY }

/**
 * Default cap on inline action work so a missing worker never hangs the submission response.
 * Overridable per host via the `dispatch.deadlineMs` plugin option; an essential action making
 * outbound calls should size its own timeouts under whichever value is in effect.
 */
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
	/**
	 * Awaited before an essential failure is returned, while the create transaction is still open:
	 * the caller stamps the submission (`actionFailed`, or `actionUncertain` on a deadline breach).
	 */
	onEssentialFailed?: (outcome: { timedOut: boolean }) => void | Promise<void>
	/**
	 * Called when a deadline-breached essential pass later settles, with the real outcome. Runs
	 * after the response went out (no open transaction). On success it is awaited AFTER the late
	 * closing pass (rest actions + prune), so the uncertain stamp outlives any partially completed
	 * reconciliation and the caller's success signals follow the finished work; a stamp-clearing
	 * caller must tolerate the row having been pruned. On failure it runs immediately.
	 */
	onEssentialSettled?: (outcome: { ok: boolean }) => void | Promise<void>
}

const canQueue = (payload: Payload): boolean => typeof payload.jobs?.queue === 'function'

const deadline = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		const timer = setTimeout(resolve, ms)
		timer.unref?.()
	})

/** Guard a caller-supplied callback so its throw can never break the dispatch flow. */
const guarded = async (
	payload: Payload,
	label: string,
	callback: (() => void | Promise<void>) | undefined
): Promise<void> => {
	try {
		await callback?.()
	} catch (error) {
		payload.logger?.error(
			`@10x-media/form-builder: ${label} callback threw: ${
				error instanceof Error ? error.message : String(error)
			}`
		)
	}
}

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
	const rest = hasEssential
		? actions.filter((instance) => !isEssentialAction(registry, instance))
		: actions

	// The pass an essential failure skips: rest actions plus, for a `persistSubmissions: false`
	// form, the prune completion. Shared by the normal flow below and by late reconciliation, where
	// a breached-then-successful essential pass finishes what the timeout interrupted. `withReq`
	// only on the request path: by the time a late settlement runs, the request transaction is gone.
	const runClosingPass = async (withReq: PayloadRequest | undefined): Promise<void> => {
		const subset = hasEssential ? ({ subset: 'rest' } as const) : {}
		if (args.hasRunner && canQueue(payload)) {
			try {
				await payload.jobs.queue({
					task: ACTIONS_TASK_SLUG,
					input: { formId: String(formId), submissionId: String(submissionId), ...subset },
					...(withReq ? { req: withReq } : {}),
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
			input: { formId, submissionId, ...subset },
			registry,
			payload,
			req: withReq,
			richText: args.richText,
		}).catch((error) => {
			payload.logger?.error(
				`@10x-media/form-builder: inline action dispatch for submission ${String(submissionId)} threw: ${
					error instanceof Error ? error.message : String(error)
				}`
			)
		})
		// Only the request path races the deadline; a late pass has no response waiting on it.
		await (withReq ? Promise.race([work, deadline(ms)]) : work)
	}

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
			const contextKey = outcome.timedOut
				? ESSENTIAL_ACTION_UNCERTAIN_CONTEXT_KEY
				: ESSENTIAL_ACTION_FAILED_CONTEXT_KEY
			if (req) {
				req.context = { ...(req.context ?? {}), [contextKey]: true }
			}
			await guarded(payload, 'onEssentialFailed', () =>
				args.onEssentialFailed?.({ timedOut: outcome.timedOut })
			)
			if (outcome.timedOut) {
				payload.logger?.error(
					`@10x-media/form-builder: essential action pass for submission ${String(submissionId)} outlived its ${ms}ms deadline; reporting the submission uncertain (the work may still complete)`
				)
				// The breached work is still running: when it settles, record the real outcome instead
				// of dropping it. On late success the closing pass the timeout skipped runs FIRST,
				// then the caller reconciles (clears the stamp, emits its success signals), matching
				// the on-time order and keeping the uncertain stamp truthful if the process dies
				// mid-reconciliation: a half-finished recovery stays flagged, never cleared.
				void work.then(async (late) => {
					payload.logger?.[late.failed ? 'error' : 'info']?.(
						`@10x-media/form-builder: essential action pass for submission ${String(submissionId)} settled after its deadline: ${
							late.failed ? 'failed' : 'succeeded'
						}`
					)
					if (!late.failed && (rest.length > 0 || args.persistSubmissions === false)) {
						await runClosingPass(undefined)
					}
					await guarded(payload, 'onEssentialSettled', () =>
						args.onEssentialSettled?.({ ok: !late.failed })
					)
				})
			}
			return { essentialFailed: true }
		}
	}

	// Nothing to run and nothing to prune: skip. An action-less form that opted out of persistence still
	// runs the completion below, so `runActionsForSubmission` can delete the row out of band.
	if (rest.length === 0 && args.persistSubmissions !== false) {
		return { essentialFailed: false }
	}

	// With an essential pass already run, the closing pass covers only the rest (subset threading
	// keeps the queued task from re-running the essential actions).
	await runClosingPass(req)
	return { essentialFailed: false }
}
