/**
 * Kebab icon name to a sentence-cased, spaced label: `align-horizontal-distribute-center`
 * becomes `Align horizontal distribute center`, `ambulance` becomes `Ambulance`. Used
 * wherever a stored `library:name` value is surfaced to an editor (the trigger label, the
 * drawer hover tooltip, the list cell); the raw `library:name` is never shown to a user.
 */
export const formatIconLabel = (name: string): string => {
	const spaced = name.replace(/[-\s]+/g, ' ').trim()
	if (spaced === '') return ''
	return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}
