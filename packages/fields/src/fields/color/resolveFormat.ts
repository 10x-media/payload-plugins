import type { PayloadRequest } from 'payload'
import { getFieldsRegistry } from '../../plugin/registry'
import type { ColorFormat } from '../../types'

/**
 * Effective stored format for a color field, resolved per request so the plugin
 * default can change without rebuilding field configs. Field-level always wins;
 * otherwise the plugin registry default; otherwise hex. Mirrors how presets
 * resolve from the field-or-registry in `resolvePresets`.
 */
export const resolveColorFormat = (
	fieldLevelFormat: ColorFormat | undefined,
	req: PayloadRequest
): ColorFormat => {
	if (fieldLevelFormat !== undefined) return fieldLevelFormat
	return getFieldsRegistry(req.payload.config)?.color?.format ?? 'hex'
}
