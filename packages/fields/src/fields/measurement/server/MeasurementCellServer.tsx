import type { DefaultServerCellComponentProps } from 'payload'
import { MeasurementCell } from '../client/MeasurementCell'
import { MEASUREMENT_CUSTOM_KEY, type MeasurementClientOptions } from '../options'
import { resolveRegistryDefault } from './resolveRegistryDefault'

type MeasurementCellServerComponentProps = {
	measurementOptions?: MeasurementClientOptions
} & DefaultServerCellComponentProps

/**
 * RSC cell so the plugin registry's `defaultUnits` reaches list cells, not just
 * the edit view. Payload's cell props carry no `req` (packages/payload/src/admin/elements/Cell.ts),
 * so the viewer's saved preference still can't be read here; the client provider
 * still supplies that reactively once it mounts.
 *
 * `field` and `onClick` are never forwarded to the client cell: the sanitized
 * server Field carries functions (our hooks/validate, Payload's own sanitize-installed
 * validate), and React's flight serializer throws on functions in client props.
 */
export const MeasurementCellServer = (props: MeasurementCellServerComponentProps) => {
	const {
		cellData,
		className,
		collectionSlug,
		columnIndex,
		customCellProps,
		field,
		link,
		linkURL,
		payload,
		rowData,
		viewType,
	} = props
	const measurementOptions =
		props.measurementOptions ??
		(field.custom?.[MEASUREMENT_CUSTOM_KEY] as MeasurementClientOptions | undefined)
	if (!measurementOptions) {
		const name = 'name' in field ? String(field.name) : ''
		throw new Error(
			`MeasurementCellServer: field "${name}" has no measurementOptions clientProp and no custom['${MEASUREMENT_CUSTOM_KEY}']`
		)
	}
	const registryDefault = resolveRegistryDefault({
		payload,
		preferenceKey: measurementOptions.preferenceKey,
		req: undefined,
	})
	return (
		<MeasurementCell
			cellData={cellData}
			className={className}
			collectionSlug={collectionSlug}
			columnIndex={columnIndex}
			customCellProps={customCellProps}
			link={link}
			linkURL={linkURL}
			measurementOptions={{
				...measurementOptions,
				...(registryDefault !== undefined ? { registryDefault } : {}),
			}}
			rowData={rowData}
			viewType={viewType}
		/>
	)
}
