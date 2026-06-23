import type { CustomComponent } from 'payload'
import { deepMerge } from 'payload'

export const createLiveCallFloatingWindow = (
	overrides?: Partial<CustomComponent<Record<string, never>>>
) => {
	const defaultComponent: CustomComponent<Record<string, never>> = {
		path: '@10x-media/sipgate/ui/LiveCallFloatingWindow',
	}
	return deepMerge<CustomComponent<Record<string, never>>>(defaultComponent, overrides ?? {})
}
