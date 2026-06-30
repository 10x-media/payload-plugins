import type { CollectionConfig } from 'payload'

export const createIvrFlowsCollection = (
	slug: string,
	voiceLinesSlug: string
): CollectionConfig => ({
	slug,
	labels: {
		singular: 'IVR Flow',
		plural: 'IVR Flows',
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
		},
		{
			name: 'phoneNumber',
			type: 'text',
			admin: {
				description: 'The DID that triggers this flow. Leave blank to use as a catch-all.',
			},
		},
		{
			name: 'isActive',
			type: 'checkbox',
			defaultValue: true,
		},
		{
			name: 'entryStepId',
			type: 'text',
			required: true,
			admin: {
				description: 'The stepId of the first step to execute when the call is answered.',
			},
		},
		{
			name: 'steps',
			type: 'array',
			required: true,
			minRows: 1,
			fields: [
				{
					name: 'stepId',
					type: 'text',
					required: true,
					admin: {
						description: 'Unique identifier for this step within the flow.',
					},
				},
				{
					name: 'type',
					type: 'select',
					required: true,
					options: [
						{ label: 'Play (announce and optionally hang up)', value: 'play' },
						{ label: 'Gather (play prompt and collect DTMF input)', value: 'gather' },
					],
				},
				{
					name: 'voiceLine',
					type: 'relationship',
					relationTo: voiceLinesSlug as 'ivr-voice-lines',
					required: true,
				},
				{
					name: 'hangupAfterPlay',
					type: 'checkbox',
					defaultValue: true,
					admin: {
						condition: (_, siblingData) => siblingData?.type === 'play',
						description: 'Hang up the call after the audio finishes playing.',
					},
				},
				{
					name: 'maxDigits',
					type: 'number',
					defaultValue: 1,
					admin: {
						condition: (_, siblingData) => siblingData?.type === 'gather',
						description: 'Maximum number of DTMF digits to collect.',
					},
				},
				{
					name: 'timeout',
					type: 'number',
					defaultValue: 5000,
					admin: {
						condition: (_, siblingData) => siblingData?.type === 'gather',
						description: 'Milliseconds to wait for DTMF input after the announcement.',
					},
				},
				{
					name: 'branches',
					type: 'array',
					admin: {
						condition: (_, siblingData) => siblingData?.type === 'gather',
						description: 'Map DTMF input values to the next step.',
					},
					fields: [
						{
							name: 'dtmf',
							type: 'text',
							required: true,
							admin: {
								description: 'DTMF input that triggers this branch (e.g. "1", "2", "123").',
							},
						},
						{
							name: 'nextStepId',
							type: 'text',
							required: true,
							admin: {
								description: 'The stepId to advance to when this branch is matched.',
							},
						},
					],
				},
				{
					name: 'fallbackStepId',
					type: 'text',
					admin: {
						condition: (_, siblingData) => siblingData?.type === 'gather',
						description: 'Step to use when no branch matches the input. Hangs up if omitted.',
					},
				},
			],
		},
	],
})
