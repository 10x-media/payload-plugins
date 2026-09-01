import type { NumberFieldServerProps } from 'payload'
import { getFieldsRegistry } from '../../../plugin/registry'
import { MeasurementField } from '../client/MeasurementField'
import type { MeasurementClientOptions } from '../options'
import { getUserMeasurementUnits } from './getUserUnits'

type MeasurementFieldServerComponentProps = {
	measurementOptions: MeasurementClientOptions
} & NumberFieldServerProps

/**
 * Resolves the viewer's saved unit and the plugin registry default per request,
 * then renders the client field with only serializable props, so the edit view
 * first-paints in the right unit.
 */
export const MeasurementFieldServer = async (props: MeasurementFieldServerComponentProps) => {
	const { clientField, measurementOptions, path, permissions, readOnly, req } = props
	const userUnits = await getUserMeasurementUnits(req)
	const registryDefault = getFieldsRegistry(req.payload.config)?.measurement?.defaultUnits?.[
		measurementOptions.usage
	]
	return (
		<MeasurementField
			field={clientField}
			measurementOptions={{
				...measurementOptions,
				...(registryDefault !== undefined ? { registryDefault } : {}),
				...(userUnits?.[measurementOptions.usage] !== undefined
					? { initialUnit: userUnits[measurementOptions.usage] }
					: {}),
			}}
			path={path}
			permissions={permissions}
			readOnly={readOnly}
		/>
	)
}
