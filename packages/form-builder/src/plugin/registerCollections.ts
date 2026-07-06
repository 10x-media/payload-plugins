import type { CollectionConfig, Config } from 'payload'
import type { ActionRegistry } from '../actions/registry'
import { registerActionsTask } from '../actions/task'
import { buildSubmissionsCollection } from '../collections/formSubmissions'
import { buildFormsCollection } from '../collections/forms'
import type { ConsentSourceRegistry } from '../consent/registry'
import type { FormEventSink } from '../events/types'
import type { FieldTypeRegistry } from '../fields/registry'
import type { PresentationDescriptorRegistry } from '../presentations/registry'
import type { ResolvedSpamConfig } from '../spam/types'
import { buildUploadOwnerStamp, buildUploadRateLimit } from '../spam/uploadHooks'
import type { ValidationRuleRegistry } from '../validation/registry'

type RegisterCollectionsArgs = {
	config: Config
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	consentRegistry: ConsentSourceRegistry
	presentationRegistry: PresentationDescriptorRegistry
	actionRegistry: ActionRegistry
	hasJobsPlugin: boolean
	events?: FormEventSink
	uploads: { enabled: boolean; slug: string; collection?: CollectionConfig }
	spam: ResolvedSpamConfig | false
	showSubmissionRawFields: boolean
}

export const registerCollections = ({
	config,
	registry,
	ruleRegistry,
	consentRegistry,
	presentationRegistry,
	actionRegistry,
	hasJobsPlugin,
	events,
	uploads,
	spam,
	showSubmissionRawFields,
}: RegisterCollectionsArgs): void => {
	registerActionsTask(config, actionRegistry)
	const hasRunner = Boolean(config.jobs?.autoRun) || hasJobsPlugin
	if (spam && uploads.enabled && uploads.collection) {
		const collection = uploads.collection
		collection.hooks = collection.hooks ?? {}
		collection.hooks.beforeOperation = [
			...(collection.hooks.beforeOperation ?? []),
			buildUploadRateLimit(spam),
		]
		collection.hooks.beforeValidate = [
			...(collection.hooks.beforeValidate ?? []),
			buildUploadOwnerStamp(spam),
		]
	}
	config.collections = [
		...(config.collections ?? []),
		...(uploads.enabled && uploads.collection ? [uploads.collection] : []),
		buildFormsCollection({
			registry,
			ruleRegistry,
			consentRegistry,
			presentationRegistry,
			actionRegistry,
		}),
		buildSubmissionsCollection({
			registry,
			ruleRegistry,
			consentRegistry,
			actionRegistry,
			events,
			hasRunner,
			uploadSlug: uploads.slug,
			spam,
			showRawFields: showSubmissionRawFields,
		}),
	]
}
