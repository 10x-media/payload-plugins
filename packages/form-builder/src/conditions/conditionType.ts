import type { AnyFormFieldDefinition } from '../fields/types'
import { type ConditionFieldType, defaultConditionType } from './fieldTypes'

/** The condition input a field type uses in the builder: its declared `conditionType` or the value-kind default. */
export const conditionTypeForDefinition = (
	definition: Pick<AnyFormFieldDefinition, 'value' | 'conditionType'>
): ConditionFieldType => definition.conditionType ?? defaultConditionType(definition.value)

/** A serializable slug -> condition type map for every registered field type, handed to the client builder. */
export const buildConditionTypeMap = (
	registry: Map<string, AnyFormFieldDefinition>
): Record<string, ConditionFieldType> => {
	const map: Record<string, ConditionFieldType> = {}
	for (const definition of registry.values()) {
		map[definition.type] = conditionTypeForDefinition(definition)
	}
	return map
}
