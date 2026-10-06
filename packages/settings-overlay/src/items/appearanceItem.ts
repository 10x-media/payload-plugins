import { labelFromKey } from '../translations'
import { keys } from '../translations/keys'
import type { ComponentItem } from '../types'

/**
 * A ready-made row for theme and language, the two controls Payload otherwise offers only on
 * `/admin/account`.
 *
 * Eager by default: the component reads cookies and config, never the database, so rendering it
 * with the page costs nothing and the row opens with no round trip.
 */
export const appearanceItem = (
	overrides: Partial<Omit<ComponentItem, 'component' | 'type'>> = {}
): ComponentItem => ({
	component: '@10x-media/settings-overlay/items#SettingsOverlayAppearance',
	keywords: ['theme', 'dark', 'light', 'language', 'locale'],
	label: labelFromKey(keys.appearanceLabel),
	slug: 'appearance',
	type: 'component',
	...overrides,
})
