import type { Config } from 'payload'
import type { RichTextBodyOption } from '../actions/body/serializeBody'
import type { ActionRegistry } from '../actions/registry'
import { registerActionsTask } from '../actions/task'
import { buildSubmissionsCollection } from '../collections/formSubmissions'
import { buildFormsCollection } from '../collections/forms'
import type { ConsentSourceRegistry } from '../consent/registry'
import type { FormEventSink } from '../events/types'
import type { FieldTypeRegistry } from '../fields/registry'
import type { ResolvedSpamConfig } from '../spam/types'
import type { ValidationRuleRegistry } from '../validation/registry'
import type { CollectionOverrides } from './collectionOverrides'
import { attachUploadsCollection, type UploadsOption } from './uploadsCollection'

type RegisterCollectionsArgs = {
	config: Config
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	consentRegistry: ConsentSourceRegistry
	actionRegistry: ActionRegistry
	richText?: RichTextBodyOption
	hasJobsPlugin: boolean
	events?: FormEventSink
	uploads: UploadsOption
	spam: ResolvedSpamConfig | false
	showSubmissionRawFields: boolean
	localizeContent: boolean
	overrides?: {
		forms?: CollectionOverrides
		formSubmissions?: CollectionOverrides
	}
}

export const registerCollections = ({
	config,
	registry,
	ruleRegistry,
	consentRegistry,
	actionRegistry,
	richText,
	hasJobsPlugin,
	events,
	uploads,
	spam,
	showSubmissionRawFields,
	localizeContent,
	overrides,
}: RegisterCollectionsArgs): void => {
	registerActionsTask(config, actionRegistry, richText)
	const hasRunner = Boolean(config.jobs?.autoRun) || hasJobsPlugin

	const uploadSlug = uploads === false ? undefined : uploads.collection
	if (uploads !== false) {
		attachUploadsCollection({ config, slug: uploads.collection, spam })
	}

	config.collections = [
		...(config.collections ?? []),
		buildFormsCollection({
			registry,
			ruleRegistry,
			consentRegistry,
			actionRegistry,
			localizeContent,
			uploadsCollectionSlug: uploadSlug,
			overrides: overrides?.forms,
		}),
		buildSubmissionsCollection({
			registry,
			ruleRegistry,
			consentRegistry,
			actionRegistry,
			richText,
			events,
			hasRunner,
			uploadSlug,
			spam,
			showRawFields: showSubmissionRawFields,
			overrides: overrides?.formSubmissions,
		}),
	]
}
