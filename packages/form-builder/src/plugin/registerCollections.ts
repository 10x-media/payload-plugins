import type { CollectionConfig, Config, Field } from 'payload'
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
import type { CollectionOverrides } from './collectionOverrides'

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
	overrides?: {
		forms?: CollectionOverrides
		formSubmissions?: CollectionOverrides
		uploads?: CollectionOverrides
	}
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
	overrides,
}: RegisterCollectionsArgs): void => {
	registerActionsTask(config, actionRegistry)
	const hasRunner = Boolean(config.jobs?.autoRun) || hasJobsPlugin

	let uploadsCollection: CollectionConfig | null = null
	if (uploads.enabled && uploads.collection) {
		const col = uploads.collection

		// Spam hooks are added first (plugin-owned invariant)
		if (spam) {
			col.hooks = col.hooks ?? {}
			col.hooks.beforeOperation = [...(col.hooks.beforeOperation ?? []), buildUploadRateLimit(spam)]
			col.hooks.beforeValidate = [...(col.hooks.beforeValidate ?? []), buildUploadOwnerStamp(spam)]
		}

		// Apply CollectionOverrides using explicit spreads after spam hooks are in place
		const ov = overrides?.uploads
		if (ov) {
			const defaultFields = (col.fields ?? []) as Field[]
			uploadsCollection = {
				...(ov ?? {}),
				...col,
				access: { ...(col.access ?? {}), ...(ov.access ?? {}) },
				admin: { ...(col.admin ?? {}), ...(ov.admin ?? {}) },
				hooks: {
					...(ov.hooks ?? {}),
					// Spam hooks stay first in each array; consumer hooks appended
					beforeOperation: [
						...(col.hooks?.beforeOperation ?? []),
						...(ov.hooks?.beforeOperation ?? []),
					],
					beforeValidate: [
						...(col.hooks?.beforeValidate ?? []),
						...(ov.hooks?.beforeValidate ?? []),
					],
				},
				fields: ov.fields ? ov.fields({ defaultFields }) : defaultFields,
			}
		} else {
			uploadsCollection = col
		}
	}

	config.collections = [
		...(config.collections ?? []),
		...(uploadsCollection ? [uploadsCollection] : []),
		buildFormsCollection({
			registry,
			ruleRegistry,
			consentRegistry,
			presentationRegistry,
			actionRegistry,
			overrides: overrides?.forms,
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
			overrides: overrides?.formSubmissions,
		}),
	]
}
