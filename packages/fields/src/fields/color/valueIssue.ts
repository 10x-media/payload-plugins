import { parseColor } from './engine'
import { PRESET_PREFIX, type ResolvedColorPreset } from './options'
import { presetReferenceIssue } from './presetReference'

export type ColorValueIssue = 'invalidColor' | 'missingPreset'

/**
 * Format-level problem with a stored or typed color value, shared by the form-bound
 * field's validate and the standalone input's own error display. Empty values have
 * no issue here; `required` is the caller's concern.
 */
export const colorValueIssue = (
	value: unknown,
	args: { linked: boolean; presets: readonly ResolvedColorPreset[] }
): ColorValueIssue | null => {
	if (typeof value !== 'string' || value === '') return null
	const { linked, presets } = args
	if (linked && value.startsWith(PRESET_PREFIX)) {
		const hasKey =
			presets.length > 0 ? (key: string) => presets.some((preset) => preset.key === key) : null
		const issue = presetReferenceIssue(value, hasKey)
		if (issue === 'invalidAlpha') return 'invalidColor'
		return issue === null ? null : 'missingPreset'
	}
	return parseColor(value) ? null : 'invalidColor'
}
