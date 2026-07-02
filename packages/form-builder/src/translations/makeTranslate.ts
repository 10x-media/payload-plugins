'use client'

import type { RendererTranslate } from '../react/contract'

/**
 * Creates a `RendererTranslate` function from a flat key→string map (e.g. the bundled `en` map).
 * Unknown keys fall back to the key itself so nothing crashes when running against an incomplete map.
 */
export const makeTranslate =
	(map: Record<string, string>): RendererTranslate =>
	(key) =>
		map[key] ?? key
