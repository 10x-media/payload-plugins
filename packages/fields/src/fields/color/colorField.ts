import type { FieldHook, JSONField, PayloadRequest, TextField, TextFieldValidation } from 'payload'
import { text } from 'payload/shared'
import { keys } from '../../translations/keys'
import { asTranslate } from '../../translations/server'
import type { ColorFormat, ColorSchemeValue } from '../../types'
import { formatColor, isColorSchemeValue, parseColor } from './engine'
import {
	COLOR_CUSTOM_KEY,
	type ColorFieldCustom,
	type ColorFieldOptions,
	type ColorFieldServerOptions,
	type ColorLinkedOptions,
	PRESET_PREFIX,
} from './options'
import { resolveColorFormat } from './resolveFormat'
import { resolvePresets } from './resolvePresets'
import { flatValue } from './schemeValue'

const buildValidate =
	(opts: { linked: boolean }): TextFieldValidation =>
	(value, args) => {
		if (typeof value === 'string' && value !== '') {
			if (opts.linked && value.startsWith(PRESET_PREFIX)) {
				if (value.length === PRESET_PREFIX.length) {
					return asTranslate(args.req.t)(keys.missingPreset)
				}
			} else if (!parseColor(value)) {
				return asTranslate(args.req.t)(keys.invalidColor)
			}
		}
		return text(value, args)
	}

const buildNormalizeHook =
	(opts: { alpha: boolean; format: ColorFormat | undefined; linked: boolean }): FieldHook =>
	({ req, value }) => {
		if (typeof value !== 'string' || value === '') return value
		if (opts.linked && value.startsWith(PRESET_PREFIX)) return value
		const parsed = parseColor(value)
		// Unparseable input passes through so validate rejects it with a proper message
		if (!parsed) return value
		return formatColor(parsed, resolveColorFormat(opts.format, req), { alpha: opts.alpha })
	}

/**
 * Text-backed color field storing a CSS string in the configured format.
 * Linked mode returns a tuple: the field plus a hidden virtual sibling
 * `${name}Resolved` populated on read (spread it into `fields`). The sibling
 * keeps the stored `preset:<key>` reference round-trip safe in the admin form
 * while consumers read the resolved CSS value.
 */
export function colorField(options?: ColorFieldOptions & { linked?: false }): TextField
export function colorField(
	options: ColorFieldOptions & { linked: (ColorLinkedOptions & { resolve?: 'value' }) | true }
): [TextField, TextField]
export function colorField(
	options: ColorFieldOptions & { linked: ColorLinkedOptions & { resolve: 'schemes' } }
): [TextField, JSONField]
export function colorField(
	options: ColorFieldOptions = {}
): TextField | [TextField, JSONField | TextField] {
	const {
		name = 'color',
		alpha = true,
		enableEyedropper = true,
		format,
		isClearable = true,
		label,
		linked: linkedOption = false,
		localized,
		overrides,
		presets,
		presetsLabel,
		required,
	} = options

	const linked = linkedOption !== false
	const linkedOptions: ColorLinkedOptions = typeof linkedOption === 'object' ? linkedOption : {}
	const linkedFallback = linkedOptions.fallback ?? null
	const resolveMode = linkedOptions.resolve ?? 'value'
	const memoKey = Symbol(`colorField:${name}`)

	// format stays possibly-undefined here; ColorFieldServer resolves the effective
	// format (field-level, else plugin registry, else hex) per request for the client.
	const clientOptions: ColorFieldServerOptions = {
		alpha,
		enableEyedropper,
		format,
		isClearable,
		linked,
		linkedFallback,
	}

	const custom: ColorFieldCustom = { memoKey, presets, presetsLabel }

	const base: TextField = {
		name,
		type: 'text',
		...(label !== undefined ? { label } : {}),
		...(required !== undefined ? { required } : {}),
		...(localized !== undefined ? { localized } : {}),
		admin: {
			components: {
				Cell: { path: '@10x-media/fields/rsc#ColorCell' },
				Field: {
					clientProps: { colorOptions: clientOptions },
					path: '@10x-media/fields/rsc#ColorFieldServer',
				},
			},
		},
		custom: { [COLOR_CUSTOM_KEY]: custom },
		hooks: { beforeValidate: [buildNormalizeHook({ alpha, format, linked })] },
		validate: buildValidate({ linked }),
	}

	const field = typeof overrides === 'function' ? overrides({ field: base }) : base

	if (!linked) return field

	const loggedRequests = new WeakSet<PayloadRequest>()

	/**
	 * Shapes a resolved value for the configured sibling. 'value' flattens a
	 * scheme to its light member so a field configured before schemes existed
	 * keeps working when its resolver starts returning them; 'schemes' inflates
	 * a flat color so consumers never branch on the shape.
	 */
	const shape = (value: null | string | ColorSchemeValue): null | string | ColorSchemeValue => {
		if (value === null) return null
		if (resolveMode === 'value') return flatValue(value)
		return isColorSchemeValue(value) ? value : { dark: value, light: value }
	}

	const resolveHook: FieldHook = async ({ collection, global, req, siblingData }) => {
		const raw = siblingData?.[field.name]
		if (typeof raw !== 'string' || raw === '') return null
		if (!raw.startsWith(PRESET_PREFIX)) return shape(raw)
		const key = raw.slice(PRESET_PREFIX.length)
		try {
			const all = await resolvePresets({ memoKey, req, source: presets })
			const match = all.find((preset) => preset.key === key)
			return shape(match ? match.value : linkedFallback)
		} catch (error) {
			// A broken resolver must not take down reads; degrade like a missing preset
			if (!loggedRequests.has(req)) {
				loggedRequests.add(req)
				const slug = collection?.slug ?? global?.slug ?? 'unknown'
				req.payload.logger.error(
					{ err: error },
					`colorField preset resolver failed for ${slug}.${field.name}`
				)
			}
			return shape(linkedFallback)
		}
	}

	const resolvedAdmin = { disableListColumn: true, hidden: true } as const

	const resolvedField: JSONField | TextField =
		resolveMode === 'schemes'
			? {
					name: `${field.name}Resolved`,
					type: 'json',
					admin: resolvedAdmin,
					hooks: { afterRead: [resolveHook] },
					virtual: true,
				}
			: {
					name: `${field.name}Resolved`,
					type: 'text',
					admin: resolvedAdmin,
					hooks: { afterRead: [resolveHook] },
					virtual: true,
				}

	return [field, resolvedField]
}
