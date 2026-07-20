import type { DefaultServerCellComponentProps } from 'payload'
import { getFromImportMap } from 'payload/shared'
import type { ReactNode } from 'react'
import { getFieldsRegistry } from '../../../plugin/registry'
import type { IconAdapter } from '../../../types'
import type { AdapterComponentsEntry } from '../shared/adapterComponents'
import { formatIconLabel } from '../shared/formatIconLabel'
import { resolveIconValue } from '../shared/value'

type IconCellProps = {
	adapters?: IconAdapter[]
	defaultLibrary?: string
} & DefaultServerCellComponentProps

/** List cell: the selected glyph plus its formatted name, degrading to name-only for unavailable or removed libraries. */
export const IconCell = (props: IconCellProps): ReactNode => {
	const { cellData, payload } = props
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
	return (
		<span className="tenx-icon-cell">
			{Icon ? <Icon name={name} size={16} /> : null}
			<span>{formatIconLabel(name)}</span>
		</span>
	)
}
