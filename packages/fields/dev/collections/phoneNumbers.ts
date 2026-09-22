import type { CollectionConfig } from 'payload'
import { phoneNumberField } from '../../src/exports/phone'

export const phoneNumbers: CollectionConfig = {
	slug: 'phone-numbers',
	admin: {
		defaultColumns: ['title', 'phone', 'nationalCell', 'e164Cell', 'emojiFlags', 'noFlags'],
		useAsTitle: 'title',
	},
	fields: [
		{ name: 'title', type: 'text', required: true },
		{
			type: 'row',
			fields: [
				{ name: 'nativeText', type: 'text', admin: { width: '50%' } },
				phoneNumberField({
					name: 'phone',
					overrides: ({ field }) => ({ ...field, admin: { ...field.admin, width: '50%' } }),
				}),
			],
		},
		{
			name: 'nativeStacked',
			type: 'text',
			admin: {
				description:
					'Native text field outside a row: the phone rows below must share its height, border, radius and margin-bottom',
			},
		},
		phoneNumberField({
			index: true,
			name: 'e164Phone',
			storage: 'e164',
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					className: 'phone-showcase-e164',
					components: {
						...field.admin?.components,
						afterInput: ['/components/phoneShowcase#PhoneShowcaseAfterInput'],
						beforeInput: ['/components/phoneShowcase#PhoneShowcaseBeforeInput'],
						Error: '/components/phoneShowcase#PhoneShowcaseError',
					},
					description:
						'storage e164: one indexed text column holding the raw E.164 string. Also carries admin.placeholder, className, style, and custom Error/beforeInput/afterInput components',
					placeholder: { de: 'Nummer eingeben', en: 'Enter a number' },
					style: { maxWidth: '32rem' },
				},
			}),
		}),
		phoneNumberField({
			name: 'possibleValidation',
			validation: 'possible',
			overrides: ({ field }) => ({
				...field,
				admin: { ...field.admin, description: 'validation possible: length alone decides' },
			}),
		}),
		phoneNumberField({
			name: 'strictValidation',
			validation: 'valid',
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					description: 'validation valid: the number must match a real range',
				},
			}),
		}),
		phoneNumberField({
			name: 'mobileOnly',
			validation: 'mobile',
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					description:
						'validation mobile: a landline is rejected, which needs metadata max or mobile',
				},
			}),
		}),
		phoneNumberField({
			flags: 'svg',
			name: 'svgFlags',
			overrides: ({ field }) => ({
				...field,
				admin: { ...field.admin, description: 'flags svg: artwork served by the plugin endpoint' },
			}),
		}),
		phoneNumberField({
			flags: 'emoji',
			name: 'emojiFlags',
			overrides: ({ field }) => ({
				...field,
				admin: { ...field.admin, description: 'flags emoji: regional indicator pairs, no artwork' },
			}),
		}),
		phoneNumberField({
			flags: 'none',
			name: 'noFlags',
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					description: 'flags none: the trigger shows the ISO code instead',
				},
			}),
		}),
		phoneNumberField({
			countries: ['AT', 'CH', 'DE', 'FR', 'GB', 'US'],
			defaultCountry: 'CH',
			name: 'allowlisted',
			overrides: ({ field }) => ({
				...field,
				admin: { ...field.admin, description: 'countries allowlist of six, defaulting to CH' },
			}),
		}),
		phoneNumberField({
			name: 'preferredFirst',
			preferredCountries: ['JP', 'KR', 'SG'],
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					description:
						'preferredCountries overriding the plugin-wide DE/AT/CH, so the picker heads with JP/KR/SG',
				},
			}),
		}),
		phoneNumberField({
			defaultCountry: 'US',
			name: 'usDefault',
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					description:
						'defaultCountry US: opening the picker has to scroll far down the list to reach it',
				},
			}),
		}),
		phoneNumberField({
			cellFormat: 'national',
			name: 'nationalCell',
			overrides: ({ field }) => ({
				...field,
				admin: { ...field.admin, description: 'cellFormat national: check the list view column' },
			}),
		}),
		phoneNumberField({
			cellFormat: 'e164',
			name: 'e164Cell',
			overrides: ({ field }) => ({
				...field,
				admin: { ...field.admin, description: 'cellFormat e164: check the list view column' },
			}),
		}),
		phoneNumberField({
			name: 'requiredPhone',
			required: true,
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					description: 'required: no clear control, and empty fails to save',
				},
			}),
		}),
		{
			type: 'row',
			fields: [
				{ name: 'nativeReadOnly', type: 'text', admin: { readOnly: true, width: '50%' } },
				phoneNumberField({
					name: 'readOnlyPhone',
					overrides: ({ field }) => ({
						...field,
						admin: {
							...field.admin,
							description:
								'admin.readOnly, which reaches a custom Field component only via clientField',
							readOnly: true,
							width: '50%',
						},
					}),
				}),
			],
		},
		phoneNumberField({
			localized: true,
			name: 'localizedPhone',
			overrides: ({ field }) => ({
				...field,
				admin: { ...field.admin, description: 'localized: one number per admin locale' },
			}),
		}),
		phoneNumberField({
			isClearable: false,
			name: 'notClearable',
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					description:
						'isClearable false: emptying the input and committing reverts to the last valid value',
				},
			}),
		}),
		phoneNumberField({
			label: { de: 'Support-Hotline', en: 'Support hotline' },
			name: 'labelled',
			overrides: ({ field }) => ({
				...field,
				admin: { ...field.admin, description: 'A localized static label, not the humanized name' },
			}),
		}),
		phoneNumberField({
			name: 'customComponents',
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					components: {
						...field.admin?.components,
						Description: '/components/phoneShowcase#PhoneShowcaseDescription',
						Label: '/components/phoneShowcase#PhoneShowcaseLabel',
					},
				},
			}),
		}),
		{
			name: 'showConditional',
			type: 'checkbox',
			admin: { description: 'Toggles the conditional phone field below' },
			defaultValue: true,
		},
		phoneNumberField({
			name: 'conditionalPhone',
			overrides: ({ field }) => ({
				...field,
				admin: {
					...field.admin,
					condition: (data: { showConditional?: boolean }) => Boolean(data.showConditional),
					description: 'admin.condition, driven by the checkbox above',
				},
			}),
		}),
	],
}
