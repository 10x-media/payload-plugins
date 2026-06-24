import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineConsentSource } from '../defineConsentSource'

type StaticConfig = { label?: string; url?: string; version?: string }

export const staticSource = defineConsentSource<StaticConfig>({
	type: 'static',
	label: keys.consentSourceStatic,
	config: [
		{ name: 'label', type: 'text', label: labelFor(keys.consentConfigLabel) },
		{ name: 'url', type: 'text', label: labelFor(keys.consentConfigUrl) },
		{ name: 'version', type: 'text', label: labelFor(keys.consentConfigVersion) },
	],
	resolve({ config }) {
		const label = String(config.label ?? '')
		const url = String(config.url ?? '')
		const version = config.version ? String(config.version) : undefined
		return {
			links: [{ label, url }],
			...(version ? { versionRef: version, versionLabel: version } : {}),
		}
	},
})
