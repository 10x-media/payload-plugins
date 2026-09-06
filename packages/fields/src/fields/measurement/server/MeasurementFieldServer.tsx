import type { NumberFieldServerProps } from 'payload'
import { getFieldsRegistry } from '../../../plugin/registry'
import { MeasurementField } from '../client/MeasurementField'
import { MEASUREMENT_CUSTOM_KEY, type MeasurementClientOptions } from '../options'
import { getUserMeasurementUnits } from './getUserUnits'

type MeasurementFieldServerComponentProps = {
	measurementOptions?: MeasurementClientOptions
} & NumberFieldServerProps

/**
 * Resolves the viewer's saved unit and the plugin registry default per request,
 * then renders the client field with only serializable props, so the edit view
 * first-paints in the right unit.
 */
export const MeasurementFieldServer = async (props: MeasurementFieldServerComponentProps) => {
	const { clientField, field, path, permissions, readOnly, req } = props
	// Hand-authored fields (not built through measurementField()) may set only
	// field.custom, with no clientProps; fall back to the stamped config.
	const measurementOptions =
		props.measurementOptions ??
		(field.custom?.[MEASUREMENT_CUSTOM_KEY] as MeasurementClientOptions | undefined)
	if (!measurementOptions) {
		throw new Error(
			`MeasurementFieldServer: field "${field.name}" has no measurementOptions clientProp and no custom['${MEASUREMENT_CUSTOM_KEY}']`
		)
	}
	const userUnits = await getUserMeasurementUnits(req)
	const { preferenceKey } = measurementOptions
	const registryDefault = getFieldsRegistry(req.payload.config)?.measurement?.defaultUnits?.[
		preferenceKey
	]
	const initialUnit = userUnits?.[preferenceKey]
	return (
		<MeasurementField
			field={clientField}
			measurementOptions={{
				...measurementOptions,
				...(registryDefault !== undefined ? { registryDefault } : {}),
				...(initialUnit !== undefined ? { initialUnit } : {}),
			}}
			path={path}
			permissions={permissions}
			readOnly={readOnly}
		/>
	)
}
