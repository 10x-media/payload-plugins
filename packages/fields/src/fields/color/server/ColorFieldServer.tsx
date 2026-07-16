import type { StaticLabel, TextFieldServerProps } from 'payload'
import { keys } from '../../../translations/keys'
import { asTranslate } from '../../../translations/server'
import { ColorField } from '../client/ColorField'
import {
	COLOR_CUSTOM_KEY,
	type ColorFieldClientOptions,
	type ColorFieldCustom,
	type ResolvedColorPreset,
} from '../options'
import { resolvePresets } from '../resolvePresets'

// Standalone fields built outside colorField() (hand-written config) have no memoKey
const FALLBACK_MEMO_KEY = Symbol('colorField:presets')

const resolveStaticLabel = (
	label: StaticLabel | undefined,
	language: string
): string | undefined => {
	if (label === undefined || typeof label === 'string') return label
	return label[language] ?? label.en ?? Object.values(label)[0]
}

type ColorFieldServerComponentProps = {
	colorOptions: ColorFieldClientOptions
} & TextFieldServerProps

/**
 * Resolves presets server-side (static arrays, async resolvers from
 * field.custom, or the plugin registry) and renders the client ColorField
 * with only serializable props. renderField supplies data/siblingData/req
 * as serverProps; they reflect the doc at render time, so data-dependent
 * resolvers refresh on save/reload, not live with sibling edits.
 */
export const ColorFieldServer = async (props: ColorFieldServerComponentProps) => {
	const { clientField, colorOptions, data, field, path, permissions, readOnly, req, siblingData } =
		props

	const custom = (field.custom?.[COLOR_CUSTOM_KEY] ?? {}) as Partial<ColorFieldCustom>
	const presets = await resolvePresets({
		data,
		memoKey: custom.memoKey ?? FALLBACK_MEMO_KEY,
		req,
		siblingData,
		source: custom.presets,
	})

	const language = req.i18n.language
	const resolvedPresets: ResolvedColorPreset[] = presets.map((preset) => ({
		key: preset.key,
		label: resolveStaticLabel(preset.label, language) ?? preset.key,
		value: preset.value,
	}))
	const presetsLabel =
		resolveStaticLabel(custom.presetsLabel, language) ?? asTranslate(req.i18n.t)(keys.presets)

	return (
		<ColorField
			colorOptions={colorOptions}
			field={clientField}
			path={path}
			permissions={permissions}
			presetsLabel={presetsLabel}
			readOnly={readOnly}
			resolvedPresets={resolvedPresets}
		/>
	)
}
