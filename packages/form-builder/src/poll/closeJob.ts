import type { Config, Payload, PayloadRequest, TaskConfig } from 'payload'
import { FORMS_SLUG } from '../collections/forms'
import { isPollClosed, type PollConfigLike, pollConfigOf } from '../form/pollState'
import { resolvePollOutcome } from './resolvePollOutcome'

export const POLL_CLOSE_TASK_SLUG = 'form-builder-poll-close'

/** Payload's jobs collection; queried directly to supersede a superseded pending close job. */
const JOBS_SLUG = 'payload-jobs'

/** Input the enqueue path stores; the handler re-loads everything else from the DB. */
export type PollCloseTaskInput = { formId: number | string }

/** The slice of a loaded form the close gate reads. */
export type PollFormLike = { pollEnabled?: boolean | null; poll?: unknown }

const hasEmptyWinners = (poll: PollConfigLike): boolean => {
	const winners = poll.outcome?.winningValues
	return (
		!Array.isArray(winners) ||
		winners.filter((value) => typeof value === 'string' && value.length > 0).length === 0
	)
}

const strategyOf = (poll: PollConfigLike): string =>
	typeof poll.type === 'string' && poll.type.length > 0 ? poll.type : 'manual'

/**
 * True when a poll's outcome should auto-resolve now: enabled, closed, still unresolved, and its
 * strategy is not `manual`. Shared by the close-job handler and the results-read fallback so the two
 * triggers apply the exact same gate.
 */
export const shouldAutoResolvePoll = (form: PollFormLike): boolean => {
	const poll = pollConfigOf(form.poll)
	return (
		form.pollEnabled === true &&
		poll != null &&
		isPollClosed(poll) &&
		hasEmptyWinners(poll) &&
		strategyOf(poll) !== 'manual'
	)
}

/**
 * Run the scheduled close for one form. Idempotent: re-loads the form and only resolves when the
 * poll is enabled, closed, still unresolved, and not `manual`, so a re-run after the outcome was
 * recorded (or a job that fires slightly early) is a safe no-op. Tolerates a deleted form.
 */
export const runPollClose = async (args: {
	payload: Payload
	input: PollCloseTaskInput
	/** Whether the hidden tally store backs the outcome aggregation (see `resolvePollOutcome`). */
	pollVotesEnabled?: boolean
	req?: PayloadRequest
}): Promise<void> => {
	const { payload, input, pollVotesEnabled, req } = args
	const form = await payload
		.findByID({ collection: FORMS_SLUG, id: input.formId, depth: 0, overrideAccess: true, req })
		.catch(() => null)
	if (!form || !shouldAutoResolvePoll(form as PollFormLike)) {
		return
	}
	await resolvePollOutcome({ payload, formId: input.formId, pollVotesEnabled, req })
}

/** Native Payload jobs task that resolves a poll's outcome once it closes. */
export const buildPollCloseTask = (pollVotesEnabled = false): TaskConfig =>
	({
		slug: POLL_CLOSE_TASK_SLUG,
		inputSchema: [{ name: 'formId', type: 'text', required: true }],
		handler: async ({ input, req }) => {
			await runPollClose({
				payload: req.payload,
				input: input as PollCloseTaskInput,
				pollVotesEnabled,
				req,
			})
			return { output: {} }
		},
	}) as TaskConfig

/** Register the poll-close task on `config.jobs.tasks`, creating the jobs config if absent. */
export const registerPollCloseTask = (config: Config, pollVotesEnabled = false): void => {
	config.jobs ??= {}
	config.jobs.tasks ??= []
	config.jobs.tasks.push(buildPollCloseTask(pollVotesEnabled))
}

const canQueue = (payload: Payload): boolean => typeof payload.jobs?.queue === 'function'

/**
 * Delete this form's pending (never-run) close jobs so a re-enqueue supersedes the prior one. Payload
 * 3.85's `jobs.queue` has no concurrency key, so this mirrors core's `deleteScheduledPublishJobs`:
 * a direct `db.deleteMany` on the jobs collection, scoped by task slug and the JSON `input.formId`.
 * Best-effort; a failure here only risks a duplicate future job, which the idempotent handler absorbs.
 */
const deletePendingCloseJobs = async (
	payload: Payload,
	formId: number | string,
	req?: PayloadRequest
): Promise<void> => {
	try {
		await payload.db.deleteMany({
			collection: JOBS_SLUG,
			req,
			where: {
				and: [
					{ completedAt: { exists: false } },
					{ processing: { equals: false } },
					{ taskSlug: { equals: POLL_CLOSE_TASK_SLUG } },
					{ 'input.formId': { equals: String(formId) } },
				],
			},
		})
	} catch (error) {
		payload.logger?.error(
			`@10x-media/form-builder: failed to clear pending poll-close jobs for form ${String(formId)}: ${
				error instanceof Error ? error.message : String(error)
			}`
		)
	}
}

/**
 * Schedule (or reschedule) the auto-close for a poll after a save. Enqueues a `waitUntil: closesAt`
 * job when the poll is enabled, has a `closesAt`, is still unresolved, and its strategy is not
 * `manual`, and only when a job runner is present (`payload.jobs.queue`); otherwise the resolve-on-read
 * fallback is the safety net. Any prior pending close job for the form is deleted first so the newest
 * `closesAt` wins. Never throws; a queue failure is logged and swallowed.
 */
export const enqueuePollClose = async (args: {
	payload: Payload
	form: { id: number | string; pollEnabled?: boolean | null; poll?: unknown }
	req?: PayloadRequest
}): Promise<void> => {
	const { payload, form, req } = args
	const poll = pollConfigOf(form.poll)
	if (form.pollEnabled !== true || !poll) {
		return
	}
	const closesAt =
		typeof poll.closesAt === 'string' && poll.closesAt.length > 0 ? poll.closesAt : undefined
	if (!closesAt || !hasEmptyWinners(poll) || strategyOf(poll) === 'manual' || !canQueue(payload)) {
		return
	}
	const waitUntil = new Date(closesAt)
	if (Number.isNaN(waitUntil.getTime())) {
		return
	}
	await deletePendingCloseJobs(payload, form.id, req)
	try {
		await payload.jobs.queue({
			task: POLL_CLOSE_TASK_SLUG,
			input: { formId: String(form.id) },
			waitUntil,
			req,
		})
	} catch (error) {
		payload.logger?.error(
			`@10x-media/form-builder: failed to enqueue poll-close for form ${String(form.id)}: ${
				error instanceof Error ? error.message : String(error)
			}`
		)
	}
}
