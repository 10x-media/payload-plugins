import type { DefaultServerCellComponentProps } from 'payload'
import { getFromImportMap } from 'payload/shared'
import type { ReactNode } from 'react'
import { getFieldsRegistry } from '../../../plugin/registry'
import type { IconAdapter } from '../../../types'
import { resolveIconMeta } from '../server/resolveIconMeta'
import type { AdapterComponentsEntry } from '../shared/adapterComponents'
import { resolveIconDisplay } from '../shared/iconLabel'
import { resolveIconValue } from '../shared/value'

type IconCellProps = {
	adapters?: IconAdapter[]
	defaultLibrary?: string
} & DefaultServerCellComponentProps

/** List cell: the selected glyph plus its label, degrading to name-only for unavailable or removed libraries. */
export const IconCell = async (props: IconCellProps): Promise<ReactNode> => {
	const { cellData, i18n, payload } = props
	if (typeof cellData !== 'string' || cellData === '') return null
	const registryIcon = getFieldsRegistry(payload.config)?.icon
	const adapters = props.adapters ?? registryIcon?.adapters ?? []
	const defaultLibrary =
		props.defaultLibrary ?? registryIcon?.defaultLibrary ?? adapters[0]?.slug ?? ''
	const { library, name } = resolveIconValue(cellData, defaultLibrary)
	const adapter = adapters.find((candidate) => candidate.slug === library)
	const Icon = adapter
		? getFromImportMap<AdapterComponentsEntry['Icon']>({
				importMap: payload.importMap,
				PayloadComponent: adapter.Icon,
				schemaPath: 'fields-icon-cell',
				silent: true,
			})
		: null
	// A cached manifest index makes this a map hit for a static library, so a long list
	// costs nothing extra. Payload renders cells without a request, hence no `req`.
	const meta = adapter ? await resolveIconMeta(adapter, name, { payload }) : null
	const display = resolveIconDisplay({ language: i18n.language, meta, name })
	return (
		<span className="tenx-icon-cell">
			{Icon ? <Icon name={name} size={16} /> : null}
			<span>{display.label}</span>
		</span>
	)
}
