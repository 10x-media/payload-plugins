import type { AdminComponent, AdminDependencies, PayloadComponent } from 'payload'
import { parsePayloadComponent } from 'payload/shared'

/**
 * Flatten a `PayloadComponent` to the string path `admin.dependencies` accepts.
 * The generator parses that path back into `path#exportName`, which is the key
 * `getFromImportMap` looks up at render time, so both sides go through Payload's
 * own parser and cannot disagree.
 */
const toAdminComponent = (component: PayloadComponent): AdminComponent | undefined => {
	const parsed = parsePayloadComponent(component)
	if (!parsed) {
		return undefined
	}
	const { clientProps, serverProps } = typeof component === 'object' ? component : {}
	return {
		...(clientProps ? { clientProps } : {}),
		path: `${parsed.path}#${parsed.exportName}`,
		...(serverProps ? { serverProps } : {}),
		type: 'component',
	}
}

/**
 * Import-map entries for components configured through plugin options. Those
 * paths live outside any component slot the import-map generator walks, so
 * without this registration `generate:importmap` would never see them. Keys are
 * `${prefix}:${name}`; an unset or `false` entry contributes nothing.
 */
export const collectComponentDependencies = (
	prefix: string,
	entries: [string, PayloadComponent | undefined][]
): AdminDependencies =>
	Object.fromEntries(
		entries.flatMap(([name, component]) => {
			const dependency = component === undefined ? undefined : toAdminComponent(component)
			return dependency ? [[`${prefix}:${name}`, dependency]] : []
		})
	)
