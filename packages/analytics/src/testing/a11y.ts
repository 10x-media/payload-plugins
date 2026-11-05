/**
 * Structural axe rules a render can be held to without a browser: names, table headers, one
 * `aria-sort`, focus under `aria-hidden`, tab order, references, ids, live regions (not contrast).
 */
export const a11yViolations = (root: Element): string[] => {
	const problems: string[] = []
	const document = root.ownerDocument
	const describe = (element: Element): string => {
		const classes = element.getAttribute('class')
		return `<${element.tagName.toLowerCase()}${classes ? ` class="${classes}"` : ''}>`
	}
	const textOf = (element: Element): string => (element.textContent ?? '').trim()
	const nameOf = (element: Element): string => {
		const label = element.getAttribute('aria-label')?.trim()
		if (label) {
			return label
		}
		const labelledBy = element.getAttribute('aria-labelledby')
		if (labelledBy) {
			return labelledBy
				.split(/\s+/)
				.map((id) => {
					const target = document.getElementById(id)
					return target ? textOf(target) : ''
				})
				.join(' ')
				.trim()
		}
		const id = element.getAttribute('id')
		const labelFor = id ? document.querySelector(`label[for="${id}"]`) : null
		if (labelFor) {
			return textOf(labelFor)
		}
		const caption = element.tagName === 'TABLE' ? element.querySelector('caption') : null
		if (caption) {
			return textOf(caption)
		}
		return textOf(element) || (element.getAttribute('title') ?? '').trim()
	}

	for (const control of root.querySelectorAll('button, a[href], [role="button"], [role="tab"]')) {
		if (nameOf(control) === '') {
			problems.push(`unnamed control ${describe(control)}`)
		}
	}
	for (const field of root.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
		if (nameOf(field) === '' && !field.closest('label')) {
			problems.push(`unnamed field ${describe(field)}`)
		}
	}
	for (const image of root.querySelectorAll('[role="img"]')) {
		if (nameOf(image) === '') {
			problems.push(`unnamed image ${describe(image)}`)
		}
	}
	for (const named of root.querySelectorAll('[aria-labelledby], [aria-controls]')) {
		for (const attribute of ['aria-labelledby', 'aria-controls']) {
			for (const id of (named.getAttribute(attribute) ?? '').split(/\s+/).filter(Boolean)) {
				if (!document.getElementById(id)) {
					problems.push(`${attribute} names no element: ${id}`)
				}
			}
		}
	}
	const ids = new Map<string, number>()
	for (const element of root.querySelectorAll('[id]')) {
		const id = element.getAttribute('id') ?? ''
		ids.set(id, (ids.get(id) ?? 0) + 1)
	}
	for (const [id, count] of ids) {
		if (count > 1) {
			problems.push(`duplicate id ${id}`)
		}
	}
	for (const element of root.querySelectorAll('[tabindex]')) {
		if (Number(element.getAttribute('tabindex')) > 0) {
			problems.push(`positive tabindex on ${describe(element)}`)
		}
	}
	const focusable =
		'button:not([disabled]), a[href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
	for (const hidden of root.querySelectorAll('[aria-hidden="true"]')) {
		if (hidden.matches(focusable) || hidden.querySelector(focusable)) {
			problems.push(`focusable inside aria-hidden ${describe(hidden)}`)
		}
	}
	for (const table of root.querySelectorAll('table')) {
		const columnHeaders = table.querySelectorAll('thead th')
		const rowHeaders = table.querySelectorAll('tbody th')
		if (columnHeaders.length === 0 && rowHeaders.length === 0) {
			problems.push(`table without headers ${describe(table)}`)
		}
		for (const header of columnHeaders) {
			if (header.getAttribute('scope') !== 'col') {
				problems.push(`column header without scope="col" in ${describe(table)}`)
			}
			if (textOf(header) === '') {
				problems.push(`empty column header in ${describe(table)}`)
			}
		}
		for (const header of rowHeaders) {
			if (header.getAttribute('scope') !== 'row') {
				problems.push(`row header without scope="row" in ${describe(table)}`)
			}
		}
		const sorted = table.querySelectorAll('[aria-sort]')
		if (sorted.length > 1) {
			problems.push(`more than one sorted column in ${describe(table)}`)
		}
		for (const header of sorted) {
			const value = header.getAttribute('aria-sort') ?? ''
			if (
				header.tagName !== 'TH' ||
				!['ascending', 'descending', 'none', 'other'].includes(value)
			) {
				problems.push(`invalid aria-sort ${value} on ${describe(header)}`)
			}
		}
	}
	for (const live of root.querySelectorAll('[aria-live]')) {
		const announcer = live.classList.contains('analytics-sr-only')
		const status = ['status', 'alert'].includes(live.getAttribute('role') ?? '')
		if (!announcer && !status) {
			problems.push(`visible live region ${describe(live)}`)
		}
	}
	return problems
}
