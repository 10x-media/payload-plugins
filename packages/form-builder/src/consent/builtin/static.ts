import { localizedIf } from '../../fields/localizedIf'
import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineConsentSource } from '../defineConsentSource'

type StaticConfig = { label?: string; url?: string; version?: string }

/** The link `label` is visitor-facing text and follows `localize`; `url` and `version` are identifiers and never do. */
export const buildStaticSource = (localize: boolean) =>
	defineConsentSource<StaticConfig>({
		type: 'static',
		label: keys.consentSourceStatic,
		config: [
			{
				name: 'label',
				type: 'text',
				label: labelFor(keys.consentConfigLabel),
				...localizedIf(localize),
			},
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

export const staticSource = buildStaticSource(true)
