import type { ArrayField } from 'payload'
import { localizedIf } from '../fields/localizedIf'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

export type DepartmentsFieldOptions = {
	/** Field name, i.e. what the row array is stored under. Defaults to `departmentEmails`. */
	name?: string
	/** Field label. Defaults to the plugin's translated one. */
	label?: ArrayField['label']
	/**
	 * Whether each row's `email` (and its `label`) carry `localized: true`, so the same field can
	 * hold a different address per locale. Default `true`; Payload strips the flag on hosts without
	 * `localization`, so it is safe either way.
	 */
	localized?: boolean
}

/**
 * The department-emails array, for the host to place on any collection or global they own: a
 * settings global, a tenants collection, a departments parent, wherever the addresses belong. The
 * plugin never registers it and never guesses where it lives; the `email.departments` resolver reads
 * it back, which is also where multi-tenant scoping goes: place this on the tenant-scoped document
 * and have the resolver return only that tenant's addresses, derived from `req`.
 *
 * A row is a `label` (how the address is named when routing a submission to it) and the `email` it
 * resolves to. Because `email` is `localized` by default, a host can hold a different address per
 * locale without changing the stored shape. The array itself is not localized, so per-locale edits
 * must address existing rows by their own auto-assigned `id` rather than re-sending id-less rows.
 *
 * It renders condensed: `admin.components.Field` is {@link CondensedArray}, which lays each row out
 * flat as `[label, email]` at 50% each with no per-row collapsible, while keeping Payload's native
 * per-locale storage and row ids.
 *
 * ```ts
 * // The host's own collection or global:
 * fields: [departmentsField()]
 *
 * // The plugin, reading it back to route a submission. `resolveDepartmentOptions` reads the array
 * // (fetched at `locale: 'all'`) and resolves each row's address for the requesting locale:
 * formBuilder({
 *   email: {
 *     departments: async ({ req }) => {
 *       const settings = await req.payload.findGlobal({ slug: 'settings', depth: 0, locale: 'all' })
 *       return resolveDepartmentOptions({ payload: req.payload, req, doc: settings })
 *     },
 *   },
 * })
 * ```
 *
 * The read above omits the save's `req` on purpose: threading it into a `locale: 'all'` read from
 * within a form's save validation flips `req.locale` to `all` and corrupts the localized write of the
 * document being saved. It reads already-committed data, so no transaction (`req`) is needed.
 */
export const departmentsField = (options: DepartmentsFieldOptions = {}): ArrayField => {
	const localize = options.localized !== false

	return {
		name: options.name ?? 'departmentEmails',
		type: 'array',
		label: options.label ?? labelForKey(keys.departmentsField),
		labels: {
			singular: labelForKey(keys.departmentSingular),
			plural: labelForKey(keys.departmentPlural),
		},
		admin: {
			description: labelForKey(keys.departmentsFieldDescription),
			components: { Field: '@10x-media/form-builder/client#CondensedArray' },
		},
		fields: [
			{
				name: 'label',
				type: 'text',
				label: labelForKey(keys.departmentLabel),
				admin: { width: '50%' },
				...localizedIf(localize),
			},
			{
				name: 'email',
				type: 'text',
				label: labelForKey(keys.departmentEmail),
				admin: { width: '50%' },
				...localizedIf(localize),
			},
		],
	}
}
