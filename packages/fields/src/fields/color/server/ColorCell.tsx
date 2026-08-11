import type { DefaultServerCellComponentProps } from 'payload'
import { keys } from '../../../translations/keys'
import { asTranslate } from '../../../translations/server'
import { PRESET_PREFIX } from '../options'
import { parsePresetReference } from '../presetReference'
import { swatchBackground } from '../schemeValue'
import './colorCell.css'

export const ColorCell = (props: DefaultServerCellComponentProps) => {
	const { cellData, field, i18n, rowData } = props
	if (typeof cellData !== 'string' || cellData === '') return null
	const isPreset = cellData.startsWith(PRESET_PREFIX)
	const name = 'name' in field ? String(field.name) : ''
	// The resolved sibling already carries the reference alpha, so the swatch
	// renders at the stored opacity without reapplying it here
	const resolvedRaw = isPreset
		? (rowData as Record<string, unknown>)?.[`${name}Resolved`]
		: cellData
	const swatch = swatchBackground(resolvedRaw)
	const ref = isPreset ? parsePresetReference(cellData) : null
	const label = isPreset ? (ref?.key ?? cellData.slice(PRESET_PREFIX.length)) : cellData
	return (
		<span className="fields-color-cell">
			<span aria-hidden="true" className="fields-color-cell__swatch">
				{swatch ? <span style={{ background: swatch }} /> : null}
			</span>
			<span>{label}</span>
			{ref && ref.alpha !== 100 ? (
				<span className="fields-color-cell__alpha">{ref.alpha}%</span>
			) : null}
			{isPreset && !swatch ? (
				<span className="fields-color-cell__missing">
					{asTranslate(i18n.t)(keys.missingPreset)}
				</span>
			) : null}
		</span>
	)
}
