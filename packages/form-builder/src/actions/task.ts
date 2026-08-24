import type { Config, Payload, PayloadRequest, TaskConfig, TypedLocale } from 'payload'
import { FORM_SUBMISSIONS_SLUG } from '../collections/formSubmissions'
import { FORMS_SLUG } from '../collections/forms'
import type { FormContextReference } from '../context/formContext'
import type { Translate } from '../fields/types'
import type { SubmissionDescriptor, SubmissionValue } from '../submissions/types'
import { asFieldTranslate } from '../translations/server'
import type { RichTextBodyOption } from './body/serializeBody'
import { type ActionRegistry, isEssentialAction } from './registry'
import type { ActionInstance, ActionResult } from './runActions'
import { runActions } from './runActions'

export const ACTIONS_TASK_SLUG = 'form-builder-actions'

/** Input the dispatch path enqueues; the handler re-loads everything else from the DB. */
/** `subset` filters by the action definitions' `essential` flag; absent runs everything ('all'). */
export type ActionsTaskInput = {
	formId: number | string
	submissionId: number | string
	subset?: 'essential' | 'rest'
}

const asActions = (value: unknown): ActionInstance[] =>
	Array.isArray(value) ? (value as ActionInstance[]) : []

const asValues = (value: unknown): SubmissionValue[] =>
	Array.isArray(value) ? (value as SubmissionValue[]) : []

const asDescriptors = (value: unknown): SubmissionDescriptor[] =>
	Array.isArray(value) ? (value as SubmissionDescriptor[]) : []

/** The verified `{ relationTo, value }` stored on a submission, or null when it carried no context. */
const asContext = (value: unknown): FormContextReference | null => {
	if (value && typeof value === 'object') {
		const { relationTo, value: reference } = value as Record<string, unknown>
		if (
			typeof relationTo === 'string' &&
			(typeof reference === 'string' || typeof reference === 'number')
		) {
			return { relationTo, value: reference }
		}
	}
	return null
}

/**
 * Load the form and submission by id and run the form's actions through the shared, failure-isolating
 * `runActions`. Tolerates a missing form or submission (the row may have been deleted between enqueue and
 * run) by returning early. Used by both the queued task handler and the inline fallback.
 */
export const runActionsForSubmission = async (args: {
	input: ActionsTaskInput
	registry: ActionRegistry
	payload: Payload
	req?: PayloadRequest
	richText?: RichTextBodyOption
}): Promise<ActionResult[]> => {
	const { input, registry, payload, req, richText } = args
	const submission = await payload
		.findByID({
			collection: FORM_SUBMISSIONS_SLUG,
			id: input.submissionId,
			depth: 0,
			overrideAccess: true,
			req,
		})
		.catch(() => null)
	if (!submission) {
		return []
	}

	// The submission's own stored locale (set from req.locale at submit) is authoritative, so the form
	// is loaded at it. A localized action config, notably the emailTeam `to`, then resolves to the
	// submission's locale even on the queued path, where the job runner's req may carry a different
	// (or no) locale than the visitor who submitted.
	const locale = typeof submission.locale === 'string' ? submission.locale : (req?.locale ?? 'en')

	const form = await payload
		.findByID({
			collection: FORMS_SLUG,
			id: input.formId,
			depth: 0,
			overrideAccess: true,
			// Cast: the stored locale is a plain string; a host's concrete locale union is unknowable from
			// the plugin, and an unrecognized code just falls back on read, so this narrows (zero runtime
			// delta) to satisfy a host whose `findByID` locale is a real union.
			locale: locale as TypedLocale,
			req,
		})
		.catch(() => null)
	if (!form) {
		return []
	}

	const t: Translate = asFieldTranslate(req?.i18n?.t ?? ((key: string) => key))

	const subset = input.subset ?? 'all'
	const selected = asActions(form.actions).filter((instance) => {
		if (subset === 'all') {
			return true
		}
		const isEssential = isEssentialAction(registry, instance)
		return subset === 'essential' ? isEssential : !isEssential
	})

	const results = await runActions({
		actions: selected,
		registry,
		richText,
		form: { id: form.id, title: typeof form.title === 'string' ? form.title : undefined },
		submissionId: submission.id,
		values: asValues(submission.values),
		descriptors: asDescriptors(submission.descriptors),
		context: asContext(submission.context),
		payload,
		req,
		locale,
		t,
	})
	// A failed action (SMTP down, webhook non-2xx, missing adapter) is isolated per action; surface it
	// so a silently undelivered email/webhook is visible instead of the submission looking successful.
	for (const result of results) {
		if (!result.ok) {
			payload.logger?.error(
				`@10x-media/form-builder: action "${result.type}" failed for submission ${String(submission.id)}: ${result.error ?? 'unknown error'}`
			)
		}
	}
	// A form can opt out of storing submissions (a pure signup that only POSTs to a provider): prune the
	// row after the whole action pass, regardless of individual action success (every action already got
	// the values). Best-effort: a delete failure is logged, never thrown. Uploads referenced in the values
	// are host-owned and not cascaded (documented).
	// Never on the essential pass: essential actions run first and their failure keeps the row (the
	// dispatcher then skips this completion entirely), so pruning belongs to the closing pass alone.
	if (subset !== 'essential' && form.persistSubmissions === false) {
		await payload
			.delete({ collection: FORM_SUBMISSIONS_SLUG, id: submission.id, overrideAccess: true, req })
			.catch((error) => {
				payload.logger?.error(
					`@10x-media/form-builder: failed to prune submission ${String(submission.id)}: ${
						error instanceof Error ? error.message : String(error)
					}`
				)
			})
	}
	return results
}

/** Native Payload jobs task that runs a submission's post-submit actions out of band. */
export const buildActionsTask = (
	registry: ActionRegistry,
	richText?: RichTextBodyOption
): TaskConfig =>
	({
		slug: ACTIONS_TASK_SLUG,
		inputSchema: [
			{ name: 'formId', type: 'text', required: true },
			{ name: 'submissionId', type: 'text', required: true },
		],
		handler: async ({ input, req }) => {
			await runActionsForSubmission({
				input: input as ActionsTaskInput,
				registry,
				payload: req.payload,
				req,
				richText,
			})
			return { output: {} }
		},
	}) as TaskConfig

/** Register the actions task on `config.jobs.tasks`, creating the jobs config if absent. */
export const registerActionsTask = (
	config: Config,
	registry: ActionRegistry,
	richText?: RichTextBodyOption
): void => {
	config.jobs ??= {}
	config.jobs.tasks ??= []
	config.jobs.tasks.push(buildActionsTask(registry, richText))
}
