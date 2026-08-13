/**
 * Whether the shortcut labels shown to the reader should use Apple's modifier keys.
 *
 * Read from the user agent rather than from the keyboard event, because the hint is drawn
 * before anything is pressed. iPhones and iPads report a Mac-like agent and have no
 * modifier keys to speak of, so they are excluded.
 */
export const isMacPlatform = (userAgent: string | undefined): boolean => {
	if (!userAgent) {
		return false
	}
	return /mac/i.test(userAgent) && !/iphone|ipad|ipod/i.test(userAgent)
}

/** Labels for the two modifiers the folder view's selection responds to. */
export const modifierLabels = (isMac: boolean): { modifier: string; range: string } => ({
	modifier: isMac ? '⌘' : 'Ctrl',
	range: isMac ? '⇧' : 'Shift',
})
