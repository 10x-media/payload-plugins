import type { Config } from 'payload'

import type { ResolvedOptions } from '../types'

const PROVIDER = '@10x-media/feedback-recorder/rsc#FeedbackRecorderProvider'
const ACTION = '@10x-media/feedback-recorder/client#FeedbackRecorderButton'

/**
 * The provider always goes in, so a recording survives navigating the admin; it renders nothing
 * of its own for a user or site without the recorder. The header button is optional.
 */
export const registerAdmin = (config: Config, options: ResolvedOptions): void => {
	config.admin ??= {}
	config.admin.components ??= {}
	config.admin.components.providers = [...(config.admin.components.providers ?? []), PROVIDER]
	if (options.headerAction) {
		config.admin.components.actions = [...(config.admin.components.actions ?? []), ACTION]
	}
}
