/**
 * Spreadable localization flag: `{ localized: true }` when `localize` is true, an empty object
 * otherwise, so `...localizedIf(flag)` adds the key only when wanted. Payload itself strips
 * `localized` from fields when the host config has no `localization`, so spreading `true` is
 * always safe.
 */
export const localizedIf = (localize: boolean): { localized: true } | Record<string, never> =>
	localize ? { localized: true } : {}
