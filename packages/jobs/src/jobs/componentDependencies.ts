import type { AdminComponent, AdminDependencies, PayloadComponent } from 'payload'

/**
 * Flatten a `PayloadComponent` to the string path `admin.dependencies` accepts.
 * Payload parses that path back into `path#exportName`, which is exactly the key
 * `getFromImportMap` looks up at render time, so an explicit `exportName` has to
 * be folded in here or the two would disagree.
 */
const toAdminComponent = (component: PayloadComponent): AdminComponent | undefined => {
	if (component === false) {
		return undefined
	}
	if (typeof component === 'string') {
		return { path: component, type: 'component' }
	}
	const { clientProps, exportName, path, serverProps } = component
	if (typeof path !== 'string') {
		return undefined
	}
	return {
		...(clientProps ? { clientProps } : {}),
		path: exportName ? `${path}#${exportName}` : path,
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
	entries: [string, false | PayloadComponent | undefined][]
): AdminDependencies =>
	Object.fromEntries(
		entries.flatMap(([name, component]) => {
			const dependency = component === undefined ? undefined : toAdminComponent(component)
			return dependency ? [[`${prefix}:${name}`, dependency]] : []
		})
	)
