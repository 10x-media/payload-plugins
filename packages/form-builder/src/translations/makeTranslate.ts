'use client'

import type { RendererTranslate } from '../react/contract'
import { en } from './en'
import { bundles } from './index'

/**
 * Build a `RendererTranslate` from either a locale code or an explicit map.
 *
 * Pass a locale code (`makeTranslate('de')`) to resolve against that shipped bundle, falling back to
 * `en` for a locale this plugin does not ship, so a host bridging its own translator never leaks the
 * raw key for an un-mirrored string. Pass a flat key->string map to use it verbatim (custom or partial
 * maps still work). Unknown keys fall back to the key itself so nothing crashes on an incomplete map.
 */
export const makeTranslate = (localeOrMap: string | Record<string, string>): RendererTranslate => {
	const map = typeof localeOrMap === 'string' ? (bundles[localeOrMap] ?? en) : localeOrMap
	return (key) => map[key] ?? key
}
