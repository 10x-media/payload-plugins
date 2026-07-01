import type { CustomComponent } from 'payload'
import { deepMerge } from 'payload'
import type { LiveCallPosition } from '../types'

type LiveCallWindowClientProps = { position: LiveCallPosition }

export const createLiveCallFloatingWindow = (
	position: LiveCallPosition = 'bottom-right',
	overrides?: Partial<CustomComponent<LiveCallWindowClientProps>>
) => {
	const defaultComponent: CustomComponent<LiveCallWindowClientProps> = {
		path: '@10x-media/sipgate/ui/LiveCallFloatingWindow',
		clientProps: { position },
	}
	return deepMerge<CustomComponent<LiveCallWindowClientProps>>(defaultComponent, overrides ?? {})
}
