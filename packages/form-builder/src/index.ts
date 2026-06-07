import { type Config, definePlugin } from 'payload'
import { registerTranslations } from './plugin/registerTranslations'

export type FormBuilderPluginOptions = {
	disabled?: boolean
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/form-builder': FormBuilderPluginOptions
	}
}

export const formBuilder = definePlugin<FormBuilderPluginOptions>({
	slug: '@10x-media/form-builder',
	order: 50,
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) return config
		registerTranslations(config)
		return config
	},
})

export type { FormBuilderPluginOptions as PluginOptions }
