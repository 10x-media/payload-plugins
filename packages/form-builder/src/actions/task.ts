import type { Config, Payload, PayloadRequest, TaskConfig } from 'payload'
import { FORM_SUBMISSIONS_SLUG } from '../collections/formSubmissions'
import { FORMS_SLUG } from '../collections/forms'
import type { Translate } from '../fields/types'
import type { SubmissionDescriptor, SubmissionValue } from '../submissions/types'
import { asFieldTranslate } from '../translations/server'
import type { RichTextBodyOption } from './body/serializeBody'
import type { ActionRegistry } from './registry'
import type { ActionInstance } from './runActions'
import { runActions } from './runActions'

export const ACTIONS_TASK_SLUG = 'form-builder-actions'

/** Input the dispatch path enqueues; the handler re-loads everything else from the DB. */
export type ActionsTaskInput = { formId: number | string; submissionId: number | string }

const asActions = (value: unknown): ActionInstance[] =>
	Array.isArray(value) ? (value as ActionInstance[]) : []

const asValues = (value: unknown): SubmissionValue[] =>
	Array.isArray(value) ? (value as SubmissionValue[]) : []

const asDescriptors = (value: unknown): SubmissionDescriptor[] =>
	Array.isArray(value) ? (value as SubmissionDescriptor[]) : []

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
}): Promise<void> => {
	const { input, registry, payload, req, richText } = args
	const form = await payload
		.findByID({
			collection: FORMS_SLUG,
			id: input.formId,
			depth: 0,
			overrideAccess: true,
			req,
		})
		.catch(() => null)
	if (!form) {
		return
	}
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
		return
	}

	const locale = typeof submission.locale === 'string' ? submission.locale : (req?.locale ?? 'en')
	const t: Translate = asFieldTranslate(req?.i18n?.t ?? ((key: string) => key))

	await runActions({
		actions: asActions(form.actions),
		registry,
		richText,
		form: { id: form.id, title: typeof form.title === 'string' ? form.title : undefined },
		submissionId: submission.id,
		values: asValues(submission.values),
		descriptors: asDescriptors(submission.descriptors),
		payload,
		req,
		locale,
		t,
	})
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
