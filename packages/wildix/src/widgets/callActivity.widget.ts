import { deepMerge, type Widget } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

const defaultWidget: Widget = {
	slug: 'call-activity',
	label: labelForKey(keys.widgetCallActivity),
	Component: '@10x-media/wildix/ui/CallActivityWidget',
}

export const createCallActivityWidget = (overrides?: Partial<Widget>): Widget => {
	return deepMerge<Widget>(defaultWidget, overrides ?? {})
}
