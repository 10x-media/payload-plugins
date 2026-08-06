/**
 * Render a `react-hotkeys-hook` chord the way the host platform writes it, so
 * tooltips describe the shortcut that is actually bound. A hardcoded "Ctrl+Z" is
 * wrong on macOS, and wrong everywhere once a host overrides `shortcuts`.
 *
 * Parsing mirrors react-hotkeys-hook's own `parseHotkeys`: the same split keys,
 * the same alias table, the same reserved modifier list. Whatever the library
 * binds as a modifier is drawn as one, and whatever it binds as a key is drawn
 * as a key, so the label can never disagree with the binding.
 */

/** Chord parts read as modifiers rather than keys. */
const MODIFIERS = ['shift', 'alt', 'meta', 'mod', 'ctrl', 'control'] as const

type Modifier = (typeof MODIFIERS)[number]

/** Modifier order both Apple and Microsoft use in their own shortcut labels. */
const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'] as const

/**
 * Key aliases react-hotkeys-hook accepts, normalized to its canonical names.
 * Its alias table also covers physical codes (`ControlLeft`, `ShiftRight`),
 * which exist for matching `event.code` and are not a form anyone writes in a
 * config, so they are left out here.
 */
const KEY_ALIASES: Record<string, string> = {
	down: 'arrowdown',
	esc: 'escape',
	left: 'arrowleft',
	return: 'enter',
	right: 'arrowright',
	up: 'arrowup',
}

const MAC_MODIFIER_LABELS: Record<string, string> = {
	alt: '⌥',
	ctrl: '⌃',
	meta: '⌘',
	shift: '⇧',
}

const MODIFIER_LABELS: Record<string, string> = {
	alt: 'Alt',
	ctrl: 'Ctrl',
	meta: 'Meta',
	shift: 'Shift',
}

/** Keys whose name reads worse than the glyph every platform prints on the cap. */
const KEY_LABELS: Record<string, string> = {
	arrowdown: '↓',
	arrowleft: '←',
	arrowright: '→',
	arrowup: '↑',
	escape: 'Esc',
}

const MAC_KEY_LABELS: Record<string, string> = {
	backspace: '⌫',
	delete: '⌦',
	enter: '↩',
	escape: '⎋',
	tab: '⇥',
}

const SPLIT_KEY = '+'
const SEQUENCE_SPLIT_KEY = '>'

/**
 * Lowercased before the alias lookup, not after, because the library lowercases
 * the whole chord before it maps anything. Looking `Left` up in a lowercase
 * alias table misses, and `mod+Left` would then be drawn as `Left` while the
 * binding listens for `arrowleft`.
 */
const normalizePart = (part: string): string => {
	const key = part.trim().toLowerCase()
	return (KEY_ALIASES[key] ?? key).replace(/key|digit|numpad/, '')
}

const isModifier = (part: string): part is Modifier => MODIFIERS.includes(part as Modifier)

const keyLabel = (key: string, isMac: boolean): string => {
	const named = (isMac ? MAC_KEY_LABELS[key] : undefined) ?? KEY_LABELS[key]
	if (named) return named
	return key.charAt(0).toUpperCase() + key.slice(1)
}

const formatChord = (chord: string, isMac: boolean): string => {
	const parts = chord.split(SPLIT_KEY).map(normalizePart).filter(Boolean)
	const present = new Set(parts.filter(isModifier))
	// `mod` is the library's platform alias and `control` its long spelling;
	// both collapse onto a canonical modifier before anything is drawn.
	if (present.has('mod')) present.add(isMac ? 'meta' : 'ctrl')
	if (present.has('control')) present.add('ctrl')

	const modifiers = MODIFIER_ORDER.filter((modifier) => present.has(modifier)).map(
		(modifier) => (isMac ? MAC_MODIFIER_LABELS : MODIFIER_LABELS)[modifier] ?? modifier
	)
	const pressed = parts.filter((part) => !isModifier(part)).map((key) => keyLabel(key, isMac))

	// macOS prints modifier glyphs run together, everything else separates them.
	return [...modifiers, ...pressed].join(isMac ? '' : '+')
}

/**
 * Human-readable form of one chord, e.g. `mod+shift+z` as `⇧⌘Z` on macOS and
 * `Ctrl+Shift+Z` elsewhere. Sequences (`g>h`) render as their steps in order.
 */
export const formatShortcut = (chord: string, isMac: boolean): string =>
	chord
		.split(SEQUENCE_SPLIT_KEY)
		.map((step) => formatChord(step, isMac))
		.filter(Boolean)
		.join(' ')

/**
 * The platform test react-hotkeys-hook itself applies to resolve `mod`, copied
 * rather than imported because the library does not export it. Diverging here
 * would label a chord with a modifier other than the one it listens for.
 */
export const isMacPlatform = (): boolean => {
	if (typeof navigator === 'undefined') return false
	return /mac/i.test(navigator.userAgent) && !/iphone|ipad|ipod/i.test(navigator.userAgent)
}
