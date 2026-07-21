import type { Payload, PayloadRequest } from 'payload'

/** One selectable department for the `emailTeam` recipients; `value` is the email address routed to. */
export type DepartmentOption = { label: string; value: string }

/**
 * Host seam resolving the selectable departments for `emailTeam`'s recipient fields (plugin option
 * `email.departments`). Req-scoped, so multi-tenant hosts derive tenant scoping from `req` (host
 * header, cookie, or auth context) and return only that tenant's departments. `value` is the literal
 * string `payload.sendEmail` accepts (an email address); `label` is how the department is named in the
 * admin select. Mirrors {@link FromAddressesResolver}. {@link resolveDepartmentOptions} builds this
 * from a `departmentsField()`-bearing document with the reusable locale fallback, so a host does not
 * reimplement it.
 */
export type DepartmentEmailsResolver = (args: {
	req: PayloadRequest
}) => Promise<DepartmentOption[]> | DepartmentOption[]

export type ResolveDepartmentsRequestArgs = {
	/** Whether the caller is authenticated (an admin/user). */
	isAuthed: boolean
	req: PayloadRequest
	resolver: DepartmentEmailsResolver
}

export type ResolveDepartmentsRequestResult = {
	status: number
	body: { options: DepartmentOption[] } | { errors: { message: string }[] }
}

/**
 * Authorize and resolve the `GET /:id/departments` request backing the recipient selects: authenticated
 * callers get the host resolver's current options for this request; anonymous callers are always
 * refused. The route id is unused (the option set is request-scoped, not per-form). Statuses mirror
 * `resolveFromAddressesRequest`: 403 unauthenticated, 503 when the resolver throws (fail closed).
 */
export const resolveDepartmentsRequest = async (
	args: ResolveDepartmentsRequestArgs
): Promise<ResolveDepartmentsRequestResult> => {
	const { isAuthed, req, resolver } = args
	if (!isAuthed) {
		return { status: 403, body: { errors: [{ message: 'Forbidden' }] } }
	}
	try {
		const options = await resolver({ req })
		return { status: 200, body: { options } }
	} catch {
		return { status: 503, body: { errors: [{ message: 'Departments unavailable' }] } }
	}
}

/**
 * Resolve one localized subfield value for `reqLocale` with the current -> default -> next-available
 * chain. A non-localized subfield (fetched at `locale: 'all'` on a host without localization) is a
 * bare string, used as-is; a localized one is a `{ [locale]: value }` map, from which `reqLocale`,
 * then `defaultLocale`, then the first non-empty configured locale wins. Empty strings are skipped
 * (they fall through the chain), and undefined is returned when nothing resolves.
 */
// biome-ignore lint/complexity/useMaxParams: the locale-fallback inputs are the minimal surface (value, reqLocale, defaultLocale, localeCodes)
export const pickLocaleValue = (
	value: unknown,
	reqLocale: string | undefined,
	defaultLocale: string | undefined,
	localeCodes: string[]
): string | undefined => {
	if (typeof value === 'string') {
		return value.length > 0 ? value : undefined
	}
	if (value == null || typeof value !== 'object') {
		return undefined
	}
	const map = value as Record<string, unknown>
	const nonEmpty = (entry: unknown): string | undefined =>
		typeof entry === 'string' && entry.length > 0 ? entry : undefined
	const ordered = [reqLocale, defaultLocale, ...localeCodes].filter(
		(code): code is string => typeof code === 'string' && code.length > 0
	)
	for (const code of ordered) {
		const hit = nonEmpty(map[code])
		if (hit !== undefined) {
			return hit
		}
	}
	// Defensive: a `locale: 'all'` fetch keys by configured locales, but a key outside them still
	// counts toward "next available" so a value is never silently dropped.
	for (const key of Object.keys(map)) {
		const hit = nonEmpty(map[key])
		if (hit !== undefined) {
			return hit
		}
	}
	return undefined
}

export type ResolveDepartmentOptionsArgs = {
	payload: Payload
	req: PayloadRequest
	/** A document fetched at `locale: 'all'`, so each localized subfield is a `{ locale: value }` map. */
	doc: Record<string, unknown>
	/** The array field name the departments live under; defaults to `departmentEmails`. */
	field?: string
}

/**
 * Build the `emailTeam` recipient options from a `departmentsField()`-bearing document (a settings
 * global, a tenants row, wherever the host placed it), fetched at `locale: 'all'`. Each row's `label`
 * and `email` are resolved for `req.locale` via the current -> default -> next-available chain (see
 * {@link pickLocaleValue}), reading `defaultLocale`/`localeCodes` from `payload.config.localization`
 * (a bare string is used as-is when localization is disabled). Rows with no resolvable email are
 * dropped; a row's label is resolved independently of its email and falls back to the email when
 * absent. This is the reusable seam a host's `email.departments` resolver returns, so tenant scoping
 * (which document is read) stays the host's call while the locale fallback stays consistent.
 */
export const resolveDepartmentOptions = (
	args: ResolveDepartmentOptionsArgs
): DepartmentOption[] => {
	const { payload, req, doc, field } = args
	const rows = doc[field ?? 'departmentEmails']
	if (!Array.isArray(rows)) {
		return []
	}
	const localization = payload.config.localization
	const localeCodes = localization ? localization.localeCodes : []
	const defaultLocale = localization ? localization.defaultLocale : undefined
	const reqLocale = typeof req.locale === 'string' ? req.locale : undefined
	const options: DepartmentOption[] = []
	for (const row of rows) {
		if (row == null || typeof row !== 'object') {
			continue
		}
		const entry = row as Record<string, unknown>
		const email = pickLocaleValue(entry.email, reqLocale, defaultLocale, localeCodes)
		if (email === undefined) {
			continue
		}
		const label = pickLocaleValue(entry.label, reqLocale, defaultLocale, localeCodes) ?? email
		options.push({ label, value: email })
	}
	return options
}
