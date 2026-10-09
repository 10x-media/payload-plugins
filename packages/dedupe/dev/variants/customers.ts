import type { FormVariantsConfig } from '@10x-media/form-variants'

/**
 * A guided create form for customers, passed to the plugin options in `payload.config.ts`: the
 * person first, then a step that checks for duplicates before the save. The full form stays the
 * default.
 */
export const customerVariants: FormVariantsConfig<'customers'> = {
	defaultVariant: 'native',
	variants: [
		{ key: 'native', label: 'Full form' },
		{
			key: 'guided',
			label: 'Guided',
			steps: [
				{
					key: 'person',
					label: 'Who is this?',
					fields: ['name', 'email', 'phone', 'birthDate'],
				},
				{
					key: 'duplicates',
					label: 'Check for duplicates',
					Component: '/components/DuplicateCheckStep#DuplicateCheckStep',
				},
			],
			ui: { width: 'half' },
		},
	],
}
