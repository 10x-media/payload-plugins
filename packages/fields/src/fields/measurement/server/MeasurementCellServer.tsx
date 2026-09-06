import type { ClientField, DefaultServerCellComponentProps } from 'payload'
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
		onClick,
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
			// The server cell props carry the sanitized Field, not ClientField; MeasurementCell
			// never reads this prop, it only drives off measurementOptions.
			field={field as unknown as ClientField}
			link={link}
			linkURL={linkURL}
			measurementOptions={{
				...measurementOptions,
				...(registryDefault !== undefined ? { registryDefault } : {}),
			}}
			onClick={onClick}
			rowData={rowData}
			viewType={viewType}
		/>
	)
}
