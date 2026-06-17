import type { Config } from 'payload'
import type { ActionRegistry } from '../actions/registry'
import { registerActionsTask } from '../actions/task'
import { buildSubmissionsCollection } from '../collections/formSubmissions'
import { buildFormsCollection } from '../collections/forms'
import type { FormEventSink } from '../events/types'
import type { FieldTypeRegistry } from '../fields/registry'
import type { PresentationDescriptorRegistry } from '../presentations/registry'
import type { ValidationRuleRegistry } from '../validation/registry'

type RegisterCollectionsArgs = {
	config: Config
	registry: FieldTypeRegistry
	ruleRegistry: ValidationRuleRegistry
	presentationRegistry: PresentationDescriptorRegistry
	actionRegistry: ActionRegistry
	events?: FormEventSink
}

export const registerCollections = ({
	config,
	registry,
	ruleRegistry,
	presentationRegistry,
	actionRegistry,
	events,
}: RegisterCollectionsArgs): void => {
	registerActionsTask(config, actionRegistry)
	const hasRunner = Boolean(config.jobs?.autoRun)
	config.collections = [
		...(config.collections ?? []),
		buildFormsCollection({ registry, ruleRegistry, presentationRegistry, actionRegistry }),
		buildSubmissionsCollection({ registry, ruleRegistry, actionRegistry, events, hasRunner }),
	]
}
