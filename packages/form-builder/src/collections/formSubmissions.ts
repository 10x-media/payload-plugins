import type { CollectionAfterChangeHook, CollectionConfig } from 'payload'
import { dispatchActions } from '../actions/dispatch'
import type { ActionRegistry } from '../actions/registry'
import type { ActionInstance } from '../actions/runActions'
import type { ConsentSourceRegistry } from '../consent/registry'
import { resolveEventSink } from '../events/resolveEventSink'
import type { FormEventSink } from '../events/types'
import type { FieldTypeRegistry } from '../fields/registry'
import { isLoggedIn } from '../plugin/access'
import { buildSpamGuard } from '../spam/spamGuard'
import type { ResolvedSpamConfig } from '../spam/types'
import { validateSubmission } from '../submissions/validateSubmission'
import type { ValidationRuleRegistry } from '../validation/registry'
import { FORMS_SLUG } from './forms'

export const FORM_SUBMISSIONS_SLUG = 'form-submissions'

type BuildSubmissionsCollectionArgs = {
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	consentRegistry: ConsentSourceRegistry
	actionRegistry?: ActionRegistry
	events?: FormEventSink
	/** Whether a job runner is likely present; gates the queued vs bounded-inline dispatch path. */
	hasRunner?: boolean
	/** Upload collection slug for file fields without an explicit `relationTo`. */
	uploadSlug?: string
	/** Resolved spam config; when active, prepends the spam guard before validation. `false` disables it. */
	spam?: ResolvedSpamConfig | false
}

const formIdOf = (form: unknown): number | string | undefined => {
	if (typeof form === 'number' || typeof form === 'string') {
		return form
	}
	if (form && typeof form === 'object' && 'id' in form) {
		const id = (form as { id: unknown }).id
		if (typeof id === 'number' || typeof id === 'string') {
			return id
		}
	}
	return undefined
}

/**
 * On a completed submission create, dispatch the form's post-submit actions and emit `submission.created`.
 * Both are side effects on an already-written row, so the whole body is wrapped: nothing it does can throw
 * past the hook (a failed action or sink must never fail the submission write). Dispatch is itself bounded
 * and non-throwing; the inline fallback is awaited so the bound caps the added latency, while the queued
 * path returns immediately. The form's `actions` are null-guarded for legacy rows created before the field
 * existed.
 */
const makeAfterChange =
	(args: {
		actionRegistry: ActionRegistry
		events?: FormEventSink
		hasRunner: boolean
	}): CollectionAfterChangeHook =>
	async ({ doc, operation, req }) => {
		if (operation !== 'create' || (doc.status != null && doc.status !== 'complete')) {
			return doc
		}
		const { payload } = req
		try {
			const formId = formIdOf(doc.form)
			if (formId == null) {
				return doc
			}
			const form = await payload
				.findByID({ collection: FORMS_SLUG, id: formId, depth: 0, overrideAccess: true, req })
				.catch(() => null)

			await dispatchActions({
				actions: (form?.actions ?? null) as ActionInstance[] | null,
				formId,
				submissionId: doc.id as number | string,
				registry: args.actionRegistry,
				payload,
				req,
				hasRunner: args.hasRunner,
			})

			try {
				await resolveEventSink(args.events).emit({
					type: 'submission.created',
					formId: String(formId),
					submissionId: String(doc.id),
					at: new Date().toISOString(),
				})
			} catch (error) {
				payload.logger?.error(
					`@10x-media/form-builder: submission.created sink threw: ${
						error instanceof Error ? error.message : String(error)
					}`
				)
			}
		} catch (error) {
			payload.logger?.error(
				`@10x-media/form-builder: afterChange dispatch failed for submission ${String(doc.id)}: ${
					error instanceof Error ? error.message : String(error)
				}`
			)
		}
		return doc
	}

export const buildSubmissionsCollection = ({
	registry,
	ruleRegistry,
	consentRegistry,
	actionRegistry = new Map(),
	events,
	hasRunner = false,
	uploadSlug,
	spam,
}: BuildSubmissionsCollectionArgs): CollectionConfig => ({
	slug: FORM_SUBMISSIONS_SLUG,
	labels: { singular: 'Submission', plural: 'Submissions' },
	admin: { group: 'Forms' },
	access: {
		create: () => true,
		read: isLoggedIn,
		update: () => false,
	},
	hooks: {
		beforeValidate: [
			...(spam ? [buildSpamGuard(spam)] : []),
			validateSubmission({ registry, ruleRegistry, consentRegistry, uploadSlug }),
		],
		afterChange: [makeAfterChange({ actionRegistry, events, hasRunner })],
	},
	fields: [
		{ name: 'form', type: 'relationship', relationTo: FORMS_SLUG, required: true },
		{
			name: 'status',
			type: 'select',
			defaultValue: 'complete',
			options: [
				{ label: 'Complete', value: 'complete' },
				{ label: 'Partial', value: 'partial' },
			],
		},
		{ name: 'locale', type: 'text' },
		{ name: 'values', type: 'json' },
		{ name: 'descriptors', type: 'json' },
		{ name: 'consent', type: 'json' },
		{ name: 'meta', type: 'json' },
		{
			name: 'answers',
			type: 'ui',
			admin: {
				components: { Field: '@10x-media/form-builder/rsc#SubmissionAnswers' },
			},
		},
	],
})
