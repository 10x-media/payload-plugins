export const formatDatePill = (iso: string): string => {
	try {
		return new Date(iso).toLocaleString(undefined, {
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			month: 'short',
		})
	} catch {
		return iso
	}
}

/** `list` with `value` added or removed; an empty list becomes `undefined`. */
export const toggled = (list: string[] | undefined, value: string): string[] | undefined => {
	const next = list?.includes(value) ? list.filter((v) => v !== value) : [...(list ?? []), value]
	return next.length ? next : undefined
}
