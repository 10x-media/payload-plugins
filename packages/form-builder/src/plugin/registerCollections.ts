import type { CollectionSlug, Config } from 'payload'
import type { RichTextBodyOption } from '../actions/body/serializeBody'
import type { FromAddressesResolver } from '../actions/fromAddresses'
import type { ActionRegistry } from '../actions/registry'
import { registerActionsTask } from '../actions/task'
import type { FormResultsAccess } from '../aggregation/resolveResultsRequest'
import type { CalcAllowed } from '../calc/normalizeCalc'
import type { CalcFunction, CalcSource } from '../calc/registry'
import type { ButtonsOption } from '../collections/buttonFields'
import { buildSubmissionsCollection } from '../collections/formSubmissions'
import { buildFormsCollection } from '../collections/forms'
import type { ResponseOption } from '../collections/redirectFields'
import type { SettingsOption } from '../collections/settingsFields'
import type { ConsentSnapshotMode } from '../consent/captureConsent'
import type { ConsentSourcesResolver } from '../consent/types'
import type { DepartmentEmailsResolver } from '../email/departments'
import type { FormEventSink } from '../events/types'
import type { FieldTypeRegistry } from '../fields/registry'
import { registerPollCloseTask } from '../poll/closeJob'
import type { OutcomeFieldsOverride } from '../poll/outcomeFields'
import type { PollTypeRegistry } from '../poll/pollTypeRegistry'
import type { PollOptionSourceRegistry } from '../poll/registry'
import { buildPollVotesCollection } from '../poll/votes/votesCollection'
import type { ResolvedSpamConfig } from '../spam/types'
import type { ValidationRuleRegistry } from '../validation/registry'
import type { CollectionOverrides } from './collectionOverrides'
import { attachUploadsCollection, type UploadsOption } from './uploadsCollection'

type RegisterCollectionsArgs = {
	config: Config
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	/** Registered calc extension names; gates which expressions the forms beforeValidate accepts. */
	calcAllowed?: CalcAllowed
	/** Registered calc sources (plugin option `calc.sources`); resolved on form reads and at submit. */
	calcSources?: Record<string, CalcSource>
	/** Registered calc functions (plugin option `calc.functions`); threaded into submit-time evaluation. */
	calcFunctions?: Record<string, CalcFunction>
	consentSources?: ConsentSourcesResolver
	consentSnapshot?: ConsentSnapshotMode
	/** Plugin `consent.resolveOnRead` (default true); false skips the per-read consent afterRead hook. */
	consentResolveOnRead?: boolean
	actionRegistry: ActionRegistry
	richText?: RichTextBodyOption
	hasJobsPlugin: boolean
	events?: FormEventSink
	uploads: UploadsOption
	spam: ResolvedSpamConfig | false
	showSubmissionRawFields: boolean
	localizeContent: boolean
	resultsAccess?: FormResultsAccess
	votedCookie: boolean
	pollSourceRegistry: PollOptionSourceRegistry
	pollTypeRegistry: PollTypeRegistry
	outcomeFields?: OutcomeFieldsOverride
	/** Resolved `poll.votes` option; `false` skips registering the hidden tally collection. */
	pollVotes: false | { overrides?: CollectionOverrides }
	buttons?: ButtonsOption
	settings?: SettingsOption
	response?: ResponseOption
	fromAddresses?: FromAddressesResolver
	departments?: DepartmentEmailsResolver
	redirectRelationships?: CollectionSlug[]
	overrides?: {
		forms?: CollectionOverrides
		formSubmissions?: CollectionOverrides
	}
}

export const registerCollections = ({
	config,
	registry,
	ruleRegistry,
	calcAllowed,
	calcSources,
	calcFunctions,
	consentSources,
	consentSnapshot,
	consentResolveOnRead,
	actionRegistry,
	richText,
	hasJobsPlugin,
	events,
	uploads,
	spam,
	showSubmissionRawFields,
	localizeContent,
	resultsAccess,
	votedCookie,
	pollSourceRegistry,
	pollTypeRegistry,
	outcomeFields,
	pollVotes,
	buttons,
	settings,
	response,
	fromAddresses,
	departments,
	redirectRelationships,
	overrides,
}: RegisterCollectionsArgs): void => {
	const pollVotesEnabled = pollVotes !== false
	registerActionsTask(config, actionRegistry, richText)
	registerPollCloseTask(config, pollVotesEnabled)
	const hasRunner = Boolean(config.jobs?.autoRun) || hasJobsPlugin

	const uploadSlug = uploads === false ? undefined : uploads.collection
	if (uploads !== false) {
		attachUploadsCollection({ config, slug: uploads.collection, spam })
	}

	// Payload lists nav entries in registration order (no nav-sort option). The primary
	// collection leads: forms, then form-submissions. Ordering the plugin's nav group against
	// host collections (including a BYO uploads collection) stays a host concern.
	config.collections = [
		...(config.collections ?? []),
		buildFormsCollection({
			registry,
			ruleRegistry,
			calcAllowed,
			calcSources,
			consentSources,
			consentResolveOnRead,
			actionRegistry,
			localizeContent,
			richText,
			uploadsCollectionSlug: uploadSlug,
			resultsAccess,
			pollVotesEnabled,
			pollSourceRegistry,
			pollTypeRegistry,
			outcomeFields,
			buttons,
			settings,
			response,
			fromAddresses,
			departments,
			redirectRelationships,
			overrides: overrides?.forms,
		}),
		buildSubmissionsCollection({
			registry,
			ruleRegistry,
			calcSources,
			calcFunctions,
			consentSources,
			consentSnapshot,
			actionRegistry,
			richText,
			events,
			hasRunner,
			uploadSlug,
			spam,
			votedCookie,
			pollSourceRegistry,
			pollVotes,
			showRawFields: showSubmissionRawFields,
			overrides: overrides?.formSubmissions,
		}),
		...(pollVotes === false ? [] : [buildPollVotesCollection({ overrides: pollVotes.overrides })]),
	]
}
