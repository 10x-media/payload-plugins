import type { IconMeta } from '../../../types'
import { formatIconLabel } from './formatIconLabel'
import { resolveStaticLabel } from './resolveStaticLabel'

/** What an editor sees for one icon: its accessible name, plus the raw name where that adds information. */
export type IconDisplayLabel = { code?: string; label: string }

/**
 * Resolves the display text for one icon. A library-supplied `label` wins; otherwise
 * the name is sentence-cased as before, so every existing manifest is unaffected.
 *
 * `code` carries the raw name for surfaces that can show it alongside the label. It is
 * the only place an editor can learn that "Hungary" stores as `HUN`, which they need to
 * write frontend code, and it is deliberately kept out of the accessible name: a screen
 * reader announcing "Hungary HUN" across 215 cells is the defect this fixes.
 */
export const resolveIconDisplay = (args: {
	language: string
	meta?: IconMeta | null
	name: string
}): IconDisplayLabel => {
	const derived = formatIconLabel(args.name)
	const supplied = resolveStaticLabel(args.meta?.label, args.language)
	if (!supplied) return { label: derived }
	// A code only earns its place when the label hides it. A label matching the name, or
	// matching what the name would have derived anyway, tells the editor nothing new.
	if (supplied === args.name || supplied === derived) return { label: supplied }
	return { code: args.name, label: supplied }
}
