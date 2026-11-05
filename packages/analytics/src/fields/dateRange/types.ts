import type { GroupField, LabelFunction } from 'payload'

/** @internal */
export type DateRangePickerAppearance = 'default' | 'dayOnly' | 'monthOnly'

/** @internal */
export interface DateRangeFieldOptions {
	pickerAppearance?: DateRangePickerAppearance
	timezone?: boolean
	/** No day after today can be picked, for a range of what already happened. */
	untilToday?: boolean
}

export interface DateRangeFieldArgs extends DateRangeFieldOptions {
	name: string
	label?: string | LabelFunction | false
	description?: string
	required?: boolean
	overrides?: (field: GroupField) => GroupField
}
