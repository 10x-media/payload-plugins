import type { FieldHook, PayloadRequest, TextField, TextFieldValidation } from 'payload'
import { text } from 'payload/shared'
import { keys } from '../../translations/keys'
import { asTranslate } from '../../translations/server'
import type { ColorFormat } from '../../types'
import { formatColor, parseColor } from './engine'
import {
	COLOR_CUSTOM_KEY,
	type ColorFieldClientOptions,
	type ColorFieldCustom,
	type ColorFieldOptions,
	type ColorLinkedOptions,
	PRESET_PREFIX,
} from './options'
import { resolvePresets } from './resolvePresets'

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
	(opts: { alpha: boolean; format: ColorFormat; linked: boolean }): FieldHook =>
	({ value }) => {
		if (typeof value !== 'string' || value === '') return value
		if (opts.linked && value.startsWith(PRESET_PREFIX)) return value
		const parsed = parseColor(value)
		// Unparseable input passes through so validate rejects it with a proper message
		if (!parsed) return value
		return formatColor(parsed, opts.format, { alpha: opts.alpha })
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
	options: ColorFieldOptions & { linked: ColorLinkedOptions | true }
): [TextField, TextField]
export function colorField(options: ColorFieldOptions = {}): TextField | [TextField, TextField] {
	const {
		name = 'color',
		alpha = true,
		enableEyedropper = true,
		format = 'hex',
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
	const linkedFallback = typeof linkedOption === 'object' ? (linkedOption.fallback ?? null) : null
	const memoKey = Symbol(`colorField:${name}`)

	const clientOptions: ColorFieldClientOptions = {
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

	const resolveHook: FieldHook = async ({ collection, global, req, siblingData }) => {
		const raw = siblingData?.[field.name]
		if (typeof raw !== 'string' || raw === '') return null
		if (!raw.startsWith(PRESET_PREFIX)) return raw
		const key = raw.slice(PRESET_PREFIX.length)
		try {
			const all = await resolvePresets({ memoKey, req, source: presets })
			const match = all.find((preset) => preset.key === key)
			return match ? match.value : linkedFallback
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
			return linkedFallback
		}
	}

	const resolvedField: TextField = {
		name: `${field.name}Resolved`,
		type: 'text',
		admin: { disableListColumn: true, hidden: true },
		hooks: { afterRead: [resolveHook] },
		virtual: true,
	}

	return [field, resolvedField]
}
