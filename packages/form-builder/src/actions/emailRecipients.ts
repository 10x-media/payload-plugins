import type { PayloadRequest, TextField } from 'payload'
import type { DepartmentEmailsResolver } from '../email/departments'
import { fieldNames, fieldNamesOfType } from '../fields/fieldNamesOfType'
import { localizedIf } from '../fields/localizedIf'
import { interpolate } from '../recall/interpolate'
import { keys } from '../translations/keys'
import { asTranslate, labelFor } from '../translations/server'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TOKEN_RE = /^\{\{\s*([\w.-]+)\s*\}\}$/

/** A plausible email address (a permissive shape check, not full RFC validation). */
export const isPlausibleEmail = (value: string): boolean => EMAIL_RE.test(value.trim())

/** The field name inside a `{{name}}` recipient token, or undefined when the string is not a token. */
export const parseFieldToken = (value: string): string | undefined => {
	const match = TOKEN_RE.exec(value.trim())
	return match ? match[1] : undefined
}

export const isFieldToken = (value: string): boolean => parseFieldToken(value) !== undefined

const toList = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string')
		: typeof value === 'string' && value.length > 0
			? [value]
			: []

/**
 * The first plausible email in a resolved value, or empty. A recipient entry names a single address,
 * so this drops anything past a separator or CR/LF that a `{{field}}` token might interpolate from
 * visitor input, closing SMTP header injection and extra-recipient injection.
 */
export const firstAddress = (value: string): string =>
	value
		.split(/[,;\n\r]+/)
		.map((part) => part.trim())
		.find(isPlausibleEmail) ?? ''

/**
 * Resolve a stored recipient value (a `string[]`, or a legacy single string) to the comma-separated
 * list `payload.sendEmail` accepts: each entry is interpolated (a `{{field}}` token resolves from the
 * submission, a plain email passes through), sanitized to a single address, empties dropped, joined.
 */
export const resolveRecipients = (value: unknown, resolve: (name: string) => string): string =>
	toList(value)
		.map((entry) => firstAddress(interpolate(entry, resolve)))
		.filter((entry) => entry.length > 0)
		.join(', ')

/**
 * Field `validate` for a recipient list: unset is fine; otherwise every entry must be a valid email
 * or a `{{field}}` token naming an existing field of an allowed token type. When `allowCustom` is
 * false, a non-token entry must additionally be a member of the resolved options (`resolveAllowed`,
 * e.g. the department addresses), matching the client constraint on the server. Fails closed if the
 * options resolver throws (mirroring the `from` field). Reads the form's `fields` off `data`. Like
 * `from`, Payload runs this on every save, so the resolver is consulted each save under
 * `allowCustom: false`; `buildRecipientField` memoizes it per request so all recipient fields share one call.
 */
export const validateRecipients =
	(opts: {
		tokenFieldTypes?: string[]
		allowCustom?: boolean
		fieldTokens?: boolean
		resolveAllowed?: (req: PayloadRequest) => Set<string> | Promise<Set<string>>
	}) =>
	async (
		value: unknown,
		{ data, req }: { data?: unknown; req: PayloadRequest }
	): Promise<string | true> => {
		const list = toList(value)
		if (list.length === 0) {
			return true
		}
		const fields =
			data && typeof data === 'object' ? (data as Record<string, unknown>).fields : undefined
		const { tokenFieldTypes, allowCustom, fieldTokens, resolveAllowed } = opts
		const allowedFields = new Set(
			tokenFieldTypes && tokenFieldTypes.length > 0
				? fieldNamesOfType(fields, tokenFieldTypes)
				: fieldNames(fields)
		)
		// Only resolve the membership set when it is actually enforced (allowCustom explicitly false),
		// so the default (free-typed) path pays no resolver cost. Compare case-insensitively, matching
		// the client's dedupe, since email delivery ignores case.
		let allowedValues: Set<string> | undefined
		if (allowCustom === false) {
			if (resolveAllowed) {
				try {
					allowedValues = await resolveAllowed(req)
				} catch {
					return asTranslate(req.t)(keys.validationRecipientOptionsUnavailable)
				}
			} else {
				allowedValues = new Set()
			}
		}
		for (const entry of list) {
			const token = parseFieldToken(entry)
			if (token) {
				// `fieldTokens: false` disables recipient tokens; enforce it on the server, not just the client.
				if (fieldTokens === false) {
					return asTranslate(req.t)(keys.validationRecipientNotAllowed)
				}
				if (!allowedFields.has(token)) {
					return asTranslate(req.t)(keys.validationRecipientUnknownField)
				}
				continue
			}
			if (!isPlausibleEmail(entry)) {
				return asTranslate(req.t)(keys.validationRecipientInvalid)
			}
			if (allowCustom === false && !allowedValues?.has(entry.trim().toLowerCase())) {
				return asTranslate(req.t)(keys.validationRecipientNotAllowed)
			}
		}
		return true
	}

/** Host-configurable behavior for the recipient fields (plugin option `email.recipients`). */
export type RecipientsConfig = {
	/** Allow free-typed emails (default true). */
	allowCustom?: boolean
	/** Offer the form's own fields as recipient tokens (default true). */
	fieldTokens?: boolean
	/** Field types eligible as tokens (default `['email']`). */
	tokenFieldTypes?: string[]
}

const RECIPIENTS_FIELD_REF = '@10x-media/form-builder/client#RecipientsSelect'

const DEPARTMENT_ALLOWED_CACHE = 'formBuilderDepartmentAllowedSet'

/**
 * The department option values as a lowercased Set, memoized on `req.context` so every recipient
 * field validated in one save shares a single `departments` call. Payload validates the fields
 * concurrently, so the in-flight promise is cached synchronously (not the resolved value) to avoid a
 * resolve-per-field race. Lowercased because email delivery ignores case, matching the client dedupe.
 */
const resolveDepartmentAllowed = (
	req: PayloadRequest,
	departments: DepartmentEmailsResolver
): Promise<Set<string>> => {
	const cached = req.context?.[DEPARTMENT_ALLOWED_CACHE]
	if (cached instanceof Promise) {
		return cached as Promise<Set<string>>
	}
	const promise = Promise.resolve()
		.then(() => departments({ req }))
		.then((options) => new Set(options.map((option) => option.value.trim().toLowerCase())))
	if (req.context) {
		req.context[DEPARTMENT_ALLOWED_CACHE] = promise
	}
	return promise
}

/**
 * A `text hasMany` field rendered by `RecipientsSelect`, used for every email address list. `endpoint`
 * (when set) supplies preset options (e.g. the host's departments); `recipients` narrows the field's
 * behavior; `width` sets `admin.width` so a pair can share a row; `departments` (when set) backs
 * server-side `allowCustom: false` enforcement with the resolved option values.
 */
// biome-ignore lint/complexity/useMaxParams: the field identity (name, label, localize) plus its grouped options is the minimal surface
export const buildRecipientField = (
	name: string,
	labelKey: string,
	localize: boolean,
	opts: {
		endpoint?: string
		recipients?: RecipientsConfig
		width?: string
		departments?: DepartmentEmailsResolver
	} = {}
): TextField => {
	const { departments } = opts
	const resolveAllowed = departments
		? (req: PayloadRequest) => resolveDepartmentAllowed(req, departments)
		: undefined
	return {
		name,
		type: 'text',
		hasMany: true,
		label: labelFor(labelKey),
		validate: validateRecipients({
			tokenFieldTypes: opts.recipients?.tokenFieldTypes ?? ['email'],
			allowCustom: opts.recipients?.allowCustom,
			fieldTokens: opts.recipients?.fieldTokens,
			resolveAllowed,
		}),
		...localizedIf(localize),
		admin: {
			...(opts.width ? { width: opts.width } : {}),
			components: {
				Field: {
					path: RECIPIENTS_FIELD_REF,
					clientProps: {
						...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
						...(opts.recipients?.allowCustom === false ? { allowCustom: false } : {}),
						...(opts.recipients?.fieldTokens === false ? { fieldTokens: false } : {}),
						...(opts.recipients?.tokenFieldTypes
							? { tokenFieldTypes: opts.recipients.tokenFieldTypes }
							: {}),
					},
				},
			},
		},
	}
}
