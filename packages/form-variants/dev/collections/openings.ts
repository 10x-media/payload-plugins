import type { CollectionConfig } from 'payload'

import { defineFormVariants } from '../../src/index'
import { isAdmin } from './users'

/** Rounds a salary to the nearest thousand, the way the listings are written. */
const toThousand = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) ? Math.round(value / 1000) * 1000 : undefined

/**
 * The showcase collection: a job opening, with the kind of field list a real one grows into and
 * four ways to fill it in. Between them they use every part of the plugin.
 *
 * - `publish`: the guided wizard. Containers and widths inside a step, presentational overrides
 *   on a field, a component item between the fields, a step that appears only for remote roles,
 *   a gate that blocks a backwards salary range and tidies the numbers it lets through, a
 *   component step that reviews the whole form and holds the save until it is confirmed, and an
 *   `afterSave` that ends on a custom `Outcome` instead of Payload's redirect.
 * - `quick`: three short steps behind a replaced `Progress`, the plain "Step 2 of 3" counter.
 * - `sections`: the same document as sections, opened in any order and saved from any of them.
 * - `native`: Payload's own form, for the admins who need the fields none of the above show.
 */
export const openings: CollectionConfig = {
	slug: 'openings',
	admin: {
		defaultColumns: ['title', 'department', 'workplace', '_status'],
		useAsTitle: 'title',
	},
	versions: { drafts: true },
	custom: {
		formVariants: defineFormVariants('openings', {
			// A new posting is walked through; an existing one is opened at its sections.
			defaultVariant: ({ operation }) => (operation === 'create' ? 'publish' : 'sections'),
			components: { Outcome: './components/OpeningOutcome#OpeningOutcome' },
			variants: [
				{
					key: 'publish',
					label: 'Publish a role',
					ui: { align: 'center', width: { page: 'half' } },
					steps: [
						{
							key: 'role',
							label: 'The role',
							description: 'What the posting is for. The title is what candidates search for.',
							fields: [
								{
									path: 'title',
									label: 'Job title',
									description: 'Say the level in it: "Senior Backend Engineer", not "Engineer II".',
								},
								{
									type: 'row',
									fields: [
										{ path: 'department', admin: { width: '50%' } },
										{ path: 'seniority', admin: { width: '50%' } },
									],
								},
								{
									type: 'row',
									fields: [
										{ path: 'employmentType', admin: { width: '60%' } },
										{ path: 'headcount', admin: { width: '40%' } },
									],
								},
								{ type: 'component', Component: './components/RoleHint#RoleHint' },
							],
						},
						{
							key: 'place',
							label: 'Where',
							description: 'Where the work happens, and which office the posting belongs to.',
							fields: [
								'workplace',
								{
									type: 'group',
									label: 'Office',
									description: 'Shown on the listing even for remote roles, as the legal entity.',
									fields: [
										{
											type: 'row',
											fields: [
												{ path: 'location.city', admin: { width: '55%' } },
												{ path: 'location.country', admin: { width: '45%' } },
											],
										},
										'location.office',
									],
								},
							],
						},
						{
							key: 'remote',
							label: 'Remote setup',
							description: 'Only asked when the role is not on site every day.',
							// Server-side, re-evaluated as the answer above changes, so the step count in
							// the progress rail moves with it.
							condition: ({ values }) =>
								values.workplace === 'remote' || values.workplace === 'hybrid',
							fields: [
								{
									path: 'timezones',
									label: 'Time zones that work',
									description: 'For example "CET ± 3 hours". Candidates filter on this.',
								},
								'officeDays',
							],
						},
						{
							key: 'money',
							label: 'Compensation',
							description: 'The range is published. What you keep in Internal is not.',
							fields: [
								{
									type: 'row',
									fields: [
										{ path: 'compensation.currency', admin: { width: '30%' } },
										{ path: 'compensation.min', admin: { width: '35%' } },
										{ path: 'compensation.max', admin: { width: '35%' } },
									],
								},
								'compensation.equity',
							],
							/**
							 * Runs on the server when the step is left forwards: refuses a range that runs
							 * backwards, and rounds a range it accepts. A gate may write to paths no step
							 * shows, which is what makes it more than client-side validation.
							 */
							gate: ({ values }) => {
								// `values` is the form's data, so a group is an object; `patch.values` below is
								// addressed by form-state path instead, which is dotted.
								const { max: high, min: low } = (values.compensation ?? {}) as {
									max?: number
									min?: number
								}
								if (typeof low === 'number' && typeof high === 'number' && high < low) {
									return {
										message: `The top of the range (${high}) is below the bottom of it (${low}).`,
										result: 'block',
									}
								}
								const rounded: Record<string, number> = {}
								const min = toThousand(low)
								const max = toThousand(high)
								if (min !== undefined && min !== low) {
									rounded['compensation.min'] = min
								}
								if (max !== undefined && max !== high) {
									rounded['compensation.max'] = max
								}
								return Object.keys(rounded).length > 0
									? { result: 'patch', state: { rangeTidied: true }, values: rounded }
									: { result: 'continue' }
							},
						},
						{
							key: 'pitch',
							label: 'The pitch',
							description: 'What a candidate reads before deciding to apply.',
							fields: [
								{
									path: 'summary',
									label: 'Short summary',
									description:
										'Two or three sentences. It is the listing card and the search result.',
								},
								'description',
								{
									type: 'collapsible',
									label: 'Lists for the posting',
									initCollapsed: true,
									fields: ['responsibilities', 'requirements'],
								},
								{
									type: 'group',
									label: 'Who runs it',
									fields: [
										{
											type: 'row',
											fields: [
												{ path: 'hiringManager', admin: { width: '60%' } },
												{ path: 'applyBy', admin: { width: '40%' } },
											],
										},
									],
								},
							],
						},
						{
							key: 'review',
							label: 'Review',
							Component: './components/OpeningReview#OpeningReview',
						},
					],
					afterSave: ({ operation, savedDoc }) =>
						operation === 'create'
							? {
									outcome: {
										id: String(savedDoc.id),
										message:
											'It is live on the careers page and the hiring manager has been notified.',
										reference: `REQ-${String(savedDoc.id).slice(-6).toUpperCase()}`,
										title: 'The role is posted',
									},
								}
							: null,
				},
				{
					key: 'quick',
					label: 'Quick draft',
					// The counter instead of the tab rail: one component off `useWizard()`. It could sit
					// on a single step, or inside a replaced `Navigation`, with no change to it.
					components: { Progress: './components/StepCounter#StepCounter' },
					ui: { width: { page: 'half' } },
					steps: [
						{
							key: 'what',
							label: 'What the role is',
							fields: [
								'title',
								{
									type: 'row',
									fields: [
										{ path: 'department', admin: { width: '50%' } },
										{ path: 'seniority', admin: { width: '50%' } },
									],
								},
							],
						},
						{
							key: 'where',
							label: 'Where it sits',
							fields: ['workplace', { type: 'row', fields: ['location.city', 'location.country'] }],
						},
						{
							key: 'numbers',
							label: 'The numbers',
							description: 'Enough to open a requisition. The rest can wait for the full form.',
							fields: [
								{
									type: 'row',
									fields: [
										{ path: 'compensation.min', admin: { width: '50%' } },
										{ path: 'compensation.max', admin: { width: '50%' } },
									],
								},
								'applyBy',
							],
						},
					],
				},
				{
					key: 'sections',
					label: 'Sections',
					navigation: 'free',
					save: 'always',
					steps: [
						{
							key: 'role',
							label: 'Role',
							fields: [
								'title',
								{
									type: 'row',
									fields: ['department', 'seniority', 'employmentType'],
								},
								'headcount',
							],
						},
						{
							key: 'place',
							label: 'Location',
							fields: ['workplace', 'location', 'timezones', 'officeDays'],
						},
						{ key: 'money', label: 'Compensation', fields: ['compensation'] },
						{
							key: 'content',
							label: 'Content',
							fields: ['summary', 'description', 'responsibilities', 'requirements', 'benefits'],
						},
						{
							key: 'process',
							label: 'Process',
							fields: ['hiringManager', 'company', 'applyBy', 'interviewStages'],
						},
						{
							key: 'internal',
							label: 'Internal',
							// Nothing to explain here, so the step drops the header the others use.
							components: { StepHeader: false },
							fields: ['internalNotes', 'referralBonus', 'status'],
						},
					],
				},
				{ key: 'native', label: 'Full form', access: ({ user }) => isAdmin(user) },
			],
		}),
	},
	fields: [
		{ name: 'title', type: 'text', required: true },
		{
			type: 'row',
			fields: [
				{
					name: 'department',
					type: 'select',
					required: true,
					options: ['engineering', 'design', 'product', 'marketing', 'sales', 'operations'],
				},
				{
					name: 'seniority',
					type: 'select',
					options: ['junior', 'mid', 'senior', 'staff', 'principal'],
				},
			],
		},
		{
			type: 'row',
			fields: [
				{
					name: 'employmentType',
					type: 'select',
					defaultValue: 'full-time',
					options: ['full-time', 'part-time', 'contract', 'internship'],
				},
				{ name: 'headcount', type: 'number', defaultValue: 1, min: 1 },
			],
		},
		{
			name: 'workplace',
			type: 'select',
			defaultValue: 'hybrid',
			options: ['onsite', 'hybrid', 'remote'],
			required: true,
		},
		{
			name: 'location',
			type: 'group',
			fields: [
				{ name: 'city', type: 'text' },
				{ name: 'country', type: 'text', defaultValue: 'Germany' },
				{ name: 'office', type: 'text', admin: { description: 'The entity that employs them.' } },
			],
		},
		{ name: 'timezones', type: 'text' },
		{ name: 'officeDays', type: 'number', admin: { description: 'Days in the office per week.' } },
		{
			name: 'compensation',
			type: 'group',
			fields: [
				{
					type: 'row',
					fields: [
						{
							name: 'currency',
							type: 'select',
							defaultValue: 'EUR',
							options: ['EUR', 'USD', 'GBP'],
						},
						{ name: 'min', type: 'number' },
						{ name: 'max', type: 'number' },
					],
				},
				{ name: 'equity', type: 'checkbox', label: 'Includes equity' },
			],
		},
		{ name: 'summary', type: 'textarea' },
		{ name: 'description', type: 'richText' },
		{
			name: 'responsibilities',
			type: 'array',
			labels: { plural: 'Responsibilities', singular: 'Responsibility' },
			fields: [{ name: 'item', type: 'text', required: true }],
		},
		{
			name: 'requirements',
			type: 'array',
			labels: { plural: 'Requirements', singular: 'Requirement' },
			fields: [
				{ name: 'item', type: 'text', required: true },
				{ name: 'mustHave', type: 'checkbox', label: 'Must have' },
			],
		},
		{
			name: 'benefits',
			type: 'select',
			hasMany: true,
			options: ['learning-budget', 'sabbatical', 'four-day-week', 'relocation', 'childcare'],
		},
		{ name: 'hiringManager', type: 'relationship', relationTo: 'people' },
		{ name: 'company', type: 'relationship', relationTo: 'companies' },
		{ name: 'applyBy', type: 'date' },
		{
			name: 'interviewStages',
			type: 'array',
			labels: { plural: 'Stages', singular: 'Stage' },
			fields: [
				{ name: 'name', type: 'text', required: true },
				{ name: 'minutes', type: 'number' },
			],
		},
		{
			type: 'collapsible',
			label: 'Internal',
			admin: { initCollapsed: true },
			fields: [
				{ name: 'internalNotes', type: 'textarea' },
				{ name: 'referralBonus', type: 'number' },
			],
		},
		{
			name: 'status',
			type: 'select',
			admin: { position: 'sidebar' },
			defaultValue: 'open',
			options: ['open', 'paused', 'filled', 'cancelled'],
		},
	],
}
