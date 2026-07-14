import { defineConsentSource } from '../../src/index'

type PoliciesConfig = {
	policyLabel?: string
	policyUrl?: string
	policyVersion?: string
}

export const companyPolicies = defineConsentSource<PoliciesConfig>({
	type: 'companyPolicies',
	label: 'Company Policies',
	config: [
		{ name: 'policyLabel', type: 'text', label: 'Label' },
		{ name: 'policyUrl', type: 'text', label: 'URL' },
		{ name: 'policyVersion', type: 'text', label: 'Version' },
	],
	resolve({ config }) {
		const label = String(config.policyLabel ?? '')
		const url = String(config.policyUrl ?? '')
		const version = config.policyVersion ? String(config.policyVersion) : undefined
		return {
			links: [{ label, url }],
			...(version ? { versionRef: version, versionLabel: version } : {}),
		}
	},
})
