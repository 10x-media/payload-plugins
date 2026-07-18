import type { Config } from 'payload'
import type { RichTextBodyOption } from '../actions/body/serializeBody'
import type { FromAddressesResolver } from '../actions/fromAddresses'
import type { ActionRegistry } from '../actions/registry'
import { registerActionsTask } from '../actions/task'
import type { FormResultsAccess } from '../aggregation/resolveResultsRequest'
import type { ButtonsOption } from '../collections/buttonFields'
import { buildSubmissionsCollection } from '../collections/formSubmissions'
import { buildFormsCollection } from '../collections/forms'
import type { ConsentSourcesResolver } from '../consent/types'
import type { FormEventSink } from '../events/types'
import type { FieldTypeRegistry } from '../fields/registry'
import type { OutcomeFieldsOverride } from '../poll/outcomeFields'
import type { PollOptionSourceRegistry } from '../poll/registry'
import type { ResolvedSpamConfig } from '../spam/types'
import type { ValidationRuleRegistry } from '../validation/registry'
import type { CollectionOverrides } from './collectionOverrides'
import { attachUploadsCollection, type UploadsOption } from './uploadsCollection'

type RegisterCollectionsArgs = {
	config: Config
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	consentSources?: ConsentSourcesResolver
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
	outcomeFields?: OutcomeFieldsOverride
	buttons?: ButtonsOption
	fromAddresses?: FromAddressesResolver
	overrides?: {
		forms?: CollectionOverrides
		formSubmissions?: CollectionOverrides
	}
}

export const registerCollections = ({
	config,
	registry,
	ruleRegistry,
	consentSources,
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
	outcomeFields,
	buttons,
	fromAddresses,
	overrides,
}: RegisterCollectionsArgs): void => {
	registerActionsTask(config, actionRegistry, richText)
	const hasRunner = Boolean(config.jobs?.autoRun) || hasJobsPlugin

	const uploadSlug = uploads === false ? undefined : uploads.collection
	if (uploads !== false) {
		attachUploadsCollection({ config, slug: uploads.collection, spam })
	}

	// Payload has no nav-sort option, so it lists collections in registration order. Register
	// `form-submissions` before `forms` so the "Forms" nav group reads alphabetically
	// (`form-submissions` < `forms`); ordering plugin nav groups against a host's own collections
	// stays a host concern.
	config.collections = [
		...(config.collections ?? []),
		buildSubmissionsCollection({
			registry,
			ruleRegistry,
			consentSources,
			actionRegistry,
			richText,
			events,
			hasRunner,
			uploadSlug,
			spam,
			votedCookie,
			pollSourceRegistry,
			showRawFields: showSubmissionRawFields,
			overrides: overrides?.formSubmissions,
		}),
		buildFormsCollection({
			registry,
			ruleRegistry,
			consentSources,
			actionRegistry,
			localizeContent,
			richText,
			uploadsCollectionSlug: uploadSlug,
			resultsAccess,
			pollSourceRegistry,
			outcomeFields,
			buttons,
			fromAddresses,
			overrides: overrides?.forms,
		}),
	]
}
