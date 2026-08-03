import type { TextFieldServerProps } from 'payload'
import { getFromImportMap } from 'payload/shared'
import type { ReactNode } from 'react'
import { getFieldsRegistry } from '../../../plugin/registry'
import type { IconAdapter, IconAvailabilityResolver } from '../../../types'
import { IconField } from '../client/IconFieldClient'
import { resolveAvailableLibraries, unionAlwaysAvailable } from '../server/availability'
import { resolveIconMeta } from '../server/resolveIconMeta'
import type { AdapterComponentsEntry } from '../shared/adapterComponents'
import { resolveStaticLabel } from '../shared/resolveStaticLabel'
import { resolveIconValue } from '../shared/value'

type IconFieldServerExtraProps = {
	adapters?: IconAdapter[]
	alwaysAvailable?: string[]
	defaultLibrary?: string
	resolveAvailable?: IconAvailabilityResolver
	showTextInput?: boolean
}

type ServerProps = IconFieldServerExtraProps & TextFieldServerProps

/**
 * Resolves adapters (inline beats registry), availability (memoized per request,
 * fails open), and adapter client components from the importMap, then renders the
 * client field with those component references as props. A missing importMap entry
 * degrades to no glyph for that library rather than throwing, so the edit view
 * never 500s over a mis-registered adapter.
 */
export const IconFieldServer = async (props: ServerProps): Promise<ReactNode> => {
	const {
		clientField,
		data,
		i18n,
		path,
		payload,
		permissions,
		readOnly,
		req,
		schemaPath,
		siblingData,
	} = props
	const registryIcon = getFieldsRegistry(payload.config)?.icon
	const adapters = props.adapters ?? registryIcon?.adapters ?? []
	const defaultLibrary =
		props.defaultLibrary ?? registryIcon?.defaultLibrary ?? adapters[0]?.slug ?? ''
	const resolver = props.resolveAvailable ?? registryIcon?.resolveAvailable
	const alwaysAvailable = unionAlwaysAvailable(props.alwaysAvailable, registryIcon?.alwaysAvailable)

	const available = await resolveAvailableLibraries({
		adapters,
		alwaysAvailable,
		data: data as Record<string, unknown> | undefined,
		req,
		resolver,
		siblingData: siblingData as Record<string, unknown> | undefined,
	})

	const adapterComponents: Record<string, AdapterComponentsEntry> = {}
	for (const adapter of adapters) {
		const Icon = getFromImportMap<AdapterComponentsEntry['Icon']>({
			importMap: payload.importMap,
			PayloadComponent: adapter.Icon,
			schemaPath: `${schemaPath ?? path}.icon-adapter`,
			silent: true,
		})
		const Assets = getFromImportMap<AdapterComponentsEntry['Assets']>({
			importMap: payload.importMap,
			PayloadComponent: adapter.Assets,
			schemaPath: `${schemaPath ?? path}.icon-adapter`,
			silent: true,
		})
		// Optional: libraries with bulk node-data (lucide, tabler) resolve a Nodes
		// loader so the drawer renders glyphs inline; radix omits it and falls back
		// to the per-icon Icon component.
		const Nodes = adapter.Nodes
			? getFromImportMap<NonNullable<AdapterComponentsEntry['Nodes']>>({
					importMap: payload.importMap,
					PayloadComponent: adapter.Nodes,
					schemaPath: `${schemaPath ?? path}.icon-adapter`,
					silent: true,
				})
			: undefined
		if (Icon && Assets)
			adapterComponents[adapter.slug] = { Assets, canvas: adapter.canvas, Icon, Nodes }
	}

	// The trigger renders from a stored value alone, so a library-supplied label has to
	// arrive with it. A miss is not an error here: an unknown or removed icon still
	// renders, falling back to the name-derived label exactly as before.
	const storedValue =
		typeof siblingData?.[String(clientField.name)] === 'string'
			? (siblingData[String(clientField.name)] as string)
			: null
	let selectedMeta = null
	if (storedValue !== null && storedValue !== '') {
		const { library, name } = resolveIconValue(storedValue, defaultLibrary)
		const adapter = adapters.find((candidate) => candidate.slug === library)
		if (adapter) selectedMeta = await resolveIconMeta(adapter, name, { payload, req })
	}

	return (
		<IconField
			adapterComponents={adapterComponents}
			adapters={adapters.map((adapter) => ({
				label: resolveStaticLabel(adapter.label, i18n.language) ?? adapter.slug,
				slug: adapter.slug,
			}))}
			available={available}
			defaultLibrary={defaultLibrary}
			field={clientField}
			path={path}
			permissions={permissions}
			readOnly={readOnly}
			schemaPath={schemaPath}
			selectedMeta={selectedMeta}
			showTextInput={props.showTextInput === true}
		/>
	)
}
