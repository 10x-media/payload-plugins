/** The given class names, space-separated, skipping the falsy ones a `flag && 'name'` modifier leaves. */
export const classNames = (...names: Array<string | false | null | undefined>): string =>
	names.filter(Boolean).join(' ')
