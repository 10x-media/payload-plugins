import type { CollectionConfig, CollectionSlug } from 'payload'
import { deepMerge } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { authenticatedCollectionAccess } from '../utils/access'

export const createIvrFlowsCollection = (
	slug: string,
	voiceLinesSlug: string,
	overrides?: Partial<CollectionConfig>
): CollectionConfig => {
	const defaults: CollectionConfig = {
		slug,
		access: authenticatedCollectionAccess,
		labels: {
			singular: labelForKey(keys.ivrFlowsSingular),
			plural: labelForKey(keys.ivrFlowsPlural),
		},
		admin: {
			useAsTitle: 'name',
			defaultColumns: ['name', 'phoneNumber', 'isActive'],
		},
		fields: [
			{
				name: 'name',
				type: 'text',
				required: true,
				label: labelForKey(keys.ivrFlowsFieldName),
			},
			{
				name: 'phoneNumber',
				type: 'text',
				label: labelForKey(keys.ivrFlowsFieldPhoneNumber),
				admin: {
					description: labelForKey(keys.ivrFlowsFieldPhoneNumberDesc),
				},
			},
			{
				name: 'isActive',
				type: 'checkbox',
				defaultValue: true,
				label: labelForKey(keys.ivrFlowsFieldIsActive),
			},
			{
				name: 'entryStepId',
				type: 'text',
				required: true,
				label: labelForKey(keys.ivrFlowsFieldEntryStepId),
				admin: {
					description: labelForKey(keys.ivrFlowsFieldEntryStepIdDesc),
				},
			},
			{
				name: 'steps',
				type: 'array',
				required: true,
				minRows: 1,
				label: labelForKey(keys.ivrFlowsFieldSteps),
				fields: [
					{
						name: 'stepId',
						type: 'text',
						required: true,
						label: labelForKey(keys.ivrFlowsFieldStepsStepId),
						admin: {
							description: labelForKey(keys.ivrFlowsFieldStepsStepIdDesc),
						},
					},
					{
						name: 'type',
						type: 'select',
						required: true,
						label: labelForKey(keys.ivrFlowsFieldStepsType),
						options: [
							{ label: 'Play (announce and optionally hang up)', value: 'play' },
							{ label: 'Gather (play prompt and collect DTMF input)', value: 'gather' },
						],
					},
					{
						name: 'voiceLine',
						type: 'relationship',
						relationTo: voiceLinesSlug as CollectionSlug,
						required: true,
						label: labelForKey(keys.ivrFlowsFieldStepsVoiceLine),
					},
					{
						name: 'hangupAfterPlay',
						type: 'checkbox',
						defaultValue: true,
						label: labelForKey(keys.ivrFlowsFieldStepsHangupAfterPlay),
						admin: {
							condition: (_, siblingData) => siblingData?.type === 'play',
							description: labelForKey(keys.ivrFlowsFieldStepsHangupAfterPlayDesc),
						},
					},
					{
						name: 'maxDigits',
						type: 'number',
						defaultValue: 1,
						label: labelForKey(keys.ivrFlowsFieldStepsMaxDigits),
						admin: {
							condition: (_, siblingData) => siblingData?.type === 'gather',
							description: labelForKey(keys.ivrFlowsFieldStepsMaxDigitsDesc),
						},
					},
					{
						name: 'timeout',
						type: 'number',
						defaultValue: 5000,
						label: labelForKey(keys.ivrFlowsFieldStepsTimeout),
						admin: {
							condition: (_, siblingData) => siblingData?.type === 'gather',
							description: labelForKey(keys.ivrFlowsFieldStepsTimeoutDesc),
						},
					},
					{
						name: 'branches',
						type: 'array',
						label: labelForKey(keys.ivrFlowsFieldStepsBranches),
						admin: {
							condition: (_, siblingData) => siblingData?.type === 'gather',
							description: labelForKey(keys.ivrFlowsFieldStepsBranchesDesc),
						},
						fields: [
							{
								name: 'dtmf',
								type: 'text',
								required: true,
								label: labelForKey(keys.ivrFlowsFieldStepsBranchesDtmf),
								admin: {
									description: labelForKey(keys.ivrFlowsFieldStepsBranchesDtmfDesc),
								},
							},
							{
								name: 'nextStepId',
								type: 'text',
								required: true,
								label: labelForKey(keys.ivrFlowsFieldStepsBranchesNextStepId),
								admin: {
									description: labelForKey(keys.ivrFlowsFieldStepsBranchesNextStepIdDesc),
								},
							},
						],
					},
					{
						name: 'fallbackStepId',
						type: 'text',
						label: labelForKey(keys.ivrFlowsFieldStepsFallbackStepId),
						admin: {
							condition: (_, siblingData) => siblingData?.type === 'gather',
							description: labelForKey(keys.ivrFlowsFieldStepsFallbackStepIdDesc),
						},
					},
				],
			},
		],
	}

	return overrides ? deepMerge(defaults, overrides) : defaults
}
