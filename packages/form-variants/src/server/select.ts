/**
 * Which variant opens: the first available of the `?variant=` parameter, the account's stored
 * choice, and the collection's default. A parameter or choice naming a variant the account
 * cannot access is ignored, so `?variant=native` does not give an editor the full form. With
 * none of the three usable, the first available variant in config order opens; with nothing
 * available at all the answer is `null` and the view shows its empty state.
 */
export const selectVariant = (args: {
	available: string[]
	defaultKey?: null | string
	requested?: null | string
	stored?: null | string
}): null | string => {
	const { available, defaultKey, requested, stored } = args
	for (const candidate of [requested, stored, defaultKey]) {
		if (candidate && available.includes(candidate)) {
			return candidate
		}
	}
	return available[0] ?? null
}
