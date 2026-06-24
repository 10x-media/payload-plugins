import { deepMerge, type Widget } from 'payload'

const defaultWidget: Widget = {
	slug: 'call-activity',
	label: 'Call Activity',
	Component: '@10x-media/sipgate/ui/CallActivityWidget',
}

export const createCallActivityWidget = (overrides?: Partial<Widget>): Widget => {
	return deepMerge<Widget>(defaultWidget, overrides ?? {})
}
