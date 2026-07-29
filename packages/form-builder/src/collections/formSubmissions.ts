import type { CollectionAfterChangeHook, CollectionConfig, Field } from 'payload'
import type { RichTextBodyOption } from '../actions/body/serializeBody'
import { dispatchActions } from '../actions/dispatch'
import type { ActionRegistry } from '../actions/registry'
import type { ActionInstance } from '../actions/runActions'
import type { CalcFunction, CalcSource } from '../calc/registry'
import type { ConsentSnapshotMode } from '../consent/captureConsent'
import type { ConsentSourcesResolver } from '../consent/types'
import { resolveEventSink } from '../events/resolveEventSink'
import type { FormEventSink } from '../events/types'
import type { FieldTypeRegistry } from '../fields/registry'
import { isLoggedIn } from '../plugin/access'
import type { CollectionOverrides } from '../plugin/collectionOverrides'
import type { PollOptionSourceRegistry } from '../poll/registry'
import { makeVoteTallyHook } from '../poll/votes/voteTallyHook'
import { buildSpamGuard } from '../spam/spamGuard'
import type { ResolvedSpamConfig } from '../spam/types'
import { formIdOf } from '../submissions/formIdOf'
import { validateSubmission } from '../submissions/validateSubmission'
import { verifyContext } from '../submissions/verifyContext'
import { POLL_CONTEXT_KEY, votedCookieName } from '../submissions/votedCookie'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import type { ValidationRuleRegistry } from '../validation/registry'
import { FORMS_SLUG } from './forms'

export const FORM_SUBMISSIONS_SLUG = 'form-submissions'

type BuildSubmissionsCollectionArgs = {
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	/** Registered calc sources; submission validation re-resolves them fresh (a failure rejects the submission). */
	calcSources?: Record<string, CalcSource>
	/** Registered calc functions; threaded into submit-time calc evaluation. */
	calcFunctions?: Record<string, CalcFunction>
	/** The host's consent sources resolver (plugin option `consent.sources`); absent when no sources are configured. */
	consentSources?: ConsentSourcesResolver
	/** What each consent proof snapshots of the agreed wording (plugin option `consent.snapshot`). */
	consentSnapshot?: ConsentSnapshotMode
	actionRegistry?: ActionRegistry
	events?: FormEventSink
	/** Whether a job runner is likely present; gates the queued vs bounded-inline dispatch path. */
	hasRunner?: boolean
	/** Body serialization customization forwarded to the inline action dispatch path. */
	richText?: RichTextBodyOption
	/** The plugin-configured uploads collection slug; absent when uploads are disabled. */
	uploadSlug?: string
	/** Resolved spam config; when active, prepends the spam guard before validation. `false` disables it. */
	spam?: ResolvedSpamConfig | false
	/** Opt-in (`poll.votedCookie`): set an httpOnly `fb-voted-{formId}` cookie on poll submission creates. */
	votedCookie?: boolean
	/** Registered poll option sources; submission validation resolves allowed values through them. */
	pollSourceRegistry?: PollOptionSourceRegistry
	/** Resolved `poll.votes` option; `false` skips registering the append-only vote tally hook. */
	pollVotes?: false | { overrides?: CollectionOverrides }
	/**
	 * When `true`, reveals the standalone `locale`, `values`, `descriptors`, `consent`, and `meta`
	 * fields in the admin UI. Default `false`, because the `SubmissionAnswers` UI component already
	 * represents them fully (locale and meta are folded into its Submission-details section).
	 */
	showRawFields?: boolean
	overrides?: CollectionOverrides
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
		richText?: RichTextBodyOption
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
				persistSubmissions: form?.persistSubmissions as boolean | undefined,
				richText: args.richText,
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

/**
 * Opt-in (`poll.votedCookie`) hook: after a submission to a poll-enabled form is created, appends
 * an httpOnly `fb-voted-{formId}=1` cookie via `req.responseHeaders`, Payload's supported channel
 * for hook-set response headers (its own auth strategies use it; `handleEndpoints` merges it into
 * every REST response). Reads the poll config `validateSubmission` stashed on `req.context`,
 * falling back to a form fetch when absent. httpOnly keeps the marker readable only server-side
 * (`hasVotedCookie`); the client `<Poll>` keeps its localStorage guard.
 */
const makeVotedCookieHook = (): CollectionAfterChangeHook => {
	return async ({ doc, operation, req }) => {
		if (operation !== 'create') {
			return doc
		}
		const formId = formIdOf(doc.form)
		if (formId == null) {
			return doc
		}
		const stashed = req.context?.[POLL_CONTEXT_KEY]
		let pollEnabled = typeof stashed === 'boolean' ? stashed : undefined
		if (pollEnabled === undefined) {
			const form = await req.payload
				.findByID({ collection: FORMS_SLUG, id: formId, depth: 0, overrideAccess: true, req })
				.catch(() => null)
			pollEnabled = form?.pollEnabled === true
		}
		if (!pollEnabled) {
			return doc
		}
		req.responseHeaders ??= new Headers()
		req.responseHeaders.append(
			'Set-Cookie',
			`${votedCookieName(formId)}=1; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`
		)
		return doc
	}
}

export const buildSubmissionsCollection = ({
	registry,
	ruleRegistry,
	calcSources,
	calcFunctions,
	consentSources,
	consentSnapshot,
	actionRegistry = new Map(),
	events,
	hasRunner = false,
	richText,
	uploadSlug,
	spam,
	votedCookie = false,
	pollSourceRegistry,
	pollVotes = false,
	showRawFields = false,
	overrides,
}: BuildSubmissionsCollectionArgs): CollectionConfig => {
	const defaultFields: Field[] = [
		{ name: 'form', type: 'relationship', relationTo: FORMS_SLUG, required: true },
		{
			name: 'status',
			type: 'select',
			defaultValue: 'complete',
			options: [
				{ label: labelForKey(keys.statusComplete), value: 'complete' },
				{ label: labelForKey(keys.statusPartial), value: 'partial' },
			],
			// Not clearable: aggregation counts `status: complete` submissions, so a cleared status
			// would drop the submission out of every poll result with nothing in the UI saying so.
			admin: { isClearable: false },
			// Defense-in-depth at the REST layer: anonymous clients cannot set status via the API.
			// The validateSubmission hook also forces 'complete' server-side, so this covers both paths.
			access: { create: isLoggedIn, update: isLoggedIn },
		},
		// answers UI appears first so it is the dominant view when opening a submission document.
		{
			name: 'answers',
			type: 'ui',
			admin: {
				components: { Field: '@10x-media/form-builder/rsc#SubmissionAnswers' },
			},
		},
		{ name: 'locale', type: 'text', admin: { hidden: !showRawFields } },
		{ name: 'values', type: 'json', admin: { hidden: !showRawFields } },
		{ name: 'descriptors', type: 'json', admin: { hidden: !showRawFields } },
		{ name: 'consent', type: 'json', admin: { hidden: !showRawFields } },
		{ name: 'meta', type: 'json', admin: { hidden: !showRawFields } },
		// The verified reference to the document this form was rendered for (see verifyContext). Only forms
		// rendered with a signed context carry one, so the group is shown only when present. Readable, so it
		// is a legible audit record of which document a submission came through.
		{
			name: 'context',
			type: 'group',
			label: labelForKey(keys.submissionContext),
			// A Payload group always materializes as an object, so gate on a populated `relationTo`
			// (not the group itself) to show it only for submissions made through a signed context.
			admin: { readOnly: true, condition: (data) => Boolean(data?.context?.relationTo) },
			fields: [
				{ name: 'relationTo', type: 'text' },
				{ name: 'value', type: 'text' },
			],
		},
	]

	return {
		...(overrides ?? {}),
		slug: FORM_SUBMISSIONS_SLUG,
		labels: {
			singular: labelForKey(keys.collectionSubmissionSingular),
			plural: labelForKey(keys.collectionSubmissionPlural),
			...(overrides?.labels ?? {}),
		},
		admin: {
			group: 'Forms',
			defaultColumns: ['form', 'status', 'locale', 'createdAt'],
			...(overrides?.admin ?? {}),
		},
		access: {
			create: () => true,
			read: isLoggedIn,
			update: () => false,
			...(overrides?.access ?? {}),
		},
		hooks: {
			...(overrides?.hooks ?? {}),
			// Spam guard + validateSubmission must remain first: they enforce the security invariant
			// that anonymous callers cannot bypass post-submit actions or supply a forged status.
			// Consumer beforeValidate hooks are appended after so they run on already-validated data.
			beforeValidate: [
				...(spam ? [buildSpamGuard(spam)] : []),
				// Verify + store the signed form context before validation stores the answers, and independently
				// of spam so it runs even with spam off.
				verifyContext(),
				validateSubmission({
					registry,
					ruleRegistry,
					calcSources,
					calcFunctions,
					consentSources,
					consentSnapshot,
					uploadSlug,
					pollSourceRegistry,
					strictUploadOwnership: spam ? spam.uploadOwnership === 'strict' : false,
				}),
				...(overrides?.hooks?.beforeValidate ?? []),
			],
			afterChange: [
				// The tally hook runs first and does not swallow errors: a bump failure must throw so
				// Payload rolls the submission create/update back inside the operation transaction,
				// rather than being absorbed by the dispatch hook's swallow-all error boundary below.
				...(pollVotes !== false ? [makeVoteTallyHook()] : []),
				makeAfterChange({ actionRegistry, events, hasRunner, richText }),
				...(votedCookie ? [makeVotedCookieHook()] : []),
				...(overrides?.hooks?.afterChange ?? []),
			],
		},
		fields: overrides?.fields ? overrides.fields({ defaultFields }) : defaultFields,
	}
}
