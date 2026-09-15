import type { ClientField, ClientTab, SanitizedFieldsPermissions } from 'payload'
import { getFieldPaths, tabHasName } from 'payload/shared'

import { tabAsGroup } from '../plugin/namedTab'

/** Where one data field sits in the tree, in the terms `RenderFields` takes. */
export type IndexedField = {
	field: ClientField
	parentIndexPath: string
	parentPath: string
	parentSchemaPath: string
	/** The permissions map of the level the field sits on. */
	permissions: SanitizedFieldsPermissions | undefined
}

type Level = Omit<IndexedField, 'field'>

/** The permissions map below a named container, the way Payload's group and tab fields derive it. */
const permissionsBelow = (
	permissions: SanitizedFieldsPermissions | undefined,
	name: string
): SanitizedFieldsPermissions | undefined => {
	if (permissions === true || permissions === undefined) {
		return permissions
	}
	const entry = permissions[name]
	if (entry === true) {
		return true
	}
	return entry?.fields
}

/**
 * Every renderable data path of a collection, mapped to what `RenderFields` needs to render
 * that field on its own: the parent paths and the permissions of its level. Mirrors how
 * Payload's own container fields pass paths down, so a field rendered by a step lands on the
 * same form state entry and schema path it has on the native form.
 *
 * A named tab is indexed at its own path too, as the group it is in the data, so a step can
 * take the whole tab the way it takes a whole group.
 *
 * Paths stop at `array` and `blocks`, which are rendered whole.
 */
export const buildFieldIndex = (
	fields: ClientField[],
	schemaPath: string,
	permissions: SanitizedFieldsPermissions | undefined
): Map<string, IndexedField> => {
	const index = new Map<string, IndexedField>()

	const walk = (levelFields: ClientField[], level: Level): void => {
		levelFields.forEach((field, i) => {
			const {
				indexPath,
				path,
				schemaPath: fieldSchemaPath,
			} = getFieldPaths({
				field,
				index: i,
				parentIndexPath: level.parentIndexPath,
				parentPath: level.parentPath,
				parentSchemaPath: level.parentSchemaPath,
			})

			if ('name' in field && typeof field.name === 'string') {
				index.set(path, { field, ...level })
			}

			switch (field.type) {
				case 'group': {
					if ('name' in field && typeof field.name === 'string') {
						walk(field.fields, {
							parentIndexPath: '',
							parentPath: path,
							parentSchemaPath: fieldSchemaPath,
							permissions: permissionsBelow(level.permissions, field.name),
						})
					} else {
						walk(field.fields, { ...level, parentIndexPath: indexPath })
					}
					break
				}
				case 'collapsible':
				case 'row': {
					walk(field.fields, { ...level, parentIndexPath: indexPath })
					break
				}
				case 'tabs': {
					field.tabs.forEach((tab, j) => {
						const named = tabHasName(tab)
						const tabForPaths: ClientTab = named ? tab : stripName(tab)
						const tabPaths = getFieldPaths({
							field: tabForPaths,
							index: j,
							parentIndexPath: indexPath,
							parentPath: path,
							parentSchemaPath: fieldSchemaPath,
						})
						if (named) {
							index.set(tabPaths.path, {
								field: tabAsGroup(tab) as unknown as ClientField,
								parentIndexPath: indexPath,
								parentPath: path,
								parentSchemaPath: fieldSchemaPath,
								permissions: level.permissions,
							})
						}
						walk(tab.fields, {
							parentIndexPath: tabPaths.indexPath,
							parentPath: tabPaths.path,
							parentSchemaPath: tabPaths.schemaPath,
							permissions: named
								? permissionsBelow(level.permissions, tab.name)
								: level.permissions,
						})
					})
					break
				}
				default:
					break
			}
		})
	}

	walk(fields, { parentIndexPath: '', parentPath: '', parentSchemaPath: schemaPath, permissions })
	return index
}

/** An unnamed tab may still carry a `name` key set to `undefined`; `getFieldPaths` checks with `in`. */
const stripName = (tab: ClientTab): ClientTab => {
	const { name: _name, ...rest } = tab as ClientTab & { name?: string }
	return rest as ClientTab
}
