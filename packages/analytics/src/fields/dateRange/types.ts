import type { GroupField } from 'payload'

export type DateRangePickerAppearance = 'default' | 'dayOnly' | 'monthOnly'

export interface DateRangeFieldOptions {
	pickerAppearance?: DateRangePickerAppearance
	timezone?: boolean
}

export interface DateRangeFieldArgs {
	name: string
	label?: string | false
	description?: string
	required?: boolean
	pickerAppearance?: DateRangePickerAppearance
	timezone?: boolean
	overrides?: (field: GroupField) => GroupField
}
