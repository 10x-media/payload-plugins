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
	type ColorPresetsSource,
	PRESET_PREFIX,
} from './options'
import {
	applyReferenceAlpha,
	formatPresetReference,
	parsePresetReference,
	presetReferenceIssue,
	presetReferenceParts,
} from './presetReference'
import { resolveColorFormat } from './resolveFormat'
import { resolvePresets } from './resolvePresets'
import { flatValue } from './schemeValue'

const buildValidate =
	(opts: {
		linked: boolean
		memoKey: symbol
		presets: ColorPresetsSource | undefined
	}): TextFieldValidation =>
	async (value, args) => {
		if (typeof value === 'string' && value !== '') {
			if (opts.linked && value.startsWith(PRESET_PREFIX)) {
				let hasKey: ((key: string) => boolean) | null = null
				if (presetReferenceParts(value)?.explicit) {
					try {
						const all = await resolvePresets({
							memoKey: opts.memoKey,
							req: args.req,
							source: opts.presets,
						})
						// An empty list means no presets are configured (or none resolved);
						// skip the existence check rather than rejecting every reference
						if (all.length > 0) hasKey = (key) => all.some((preset) => preset.key === key)
					} catch {
						// A broken resolver must not block writes; reads degrade and log separately
					}
				}
				const issue = presetReferenceIssue(value, hasKey)
				if (issue === 'invalidAlpha') return asTranslate(args.req.t)(keys.invalidColor)
				if (issue !== null) return asTranslate(args.req.t)(keys.missingPreset)
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
		if (opts.linked && value.startsWith(PRESET_PREFIX)) {
			const parts = presetReferenceParts(value)
			// Empty keys pass through so validate rejects them with a proper message
			if (!parts) return value
			return formatPresetReference(parts.key, opts.alpha ? parts.alpha : 100)
		}
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
		validate: buildValidate({ linked, memoKey, presets }),
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

	/** The stored reference alpha, applied to whatever the reference resolved to. */
	const withAlpha = (
		resolved: null | string | ColorSchemeValue,
		refAlpha: number,
		req: PayloadRequest
	): null | string | ColorSchemeValue => {
		const effective = alpha ? refAlpha : 100
		if (resolved === null || effective === 100) return resolved
		return applyReferenceAlpha(resolved, effective, resolveColorFormat(format, req))
	}

	const resolveHook: FieldHook = async ({ collection, global, req, siblingData }) => {
		const raw = siblingData?.[field.name]
		if (typeof raw !== 'string' || raw === '') return null
		if (!raw.startsWith(PRESET_PREFIX)) return shape(raw)
		const ref = parsePresetReference(raw)
		const key = ref?.key ?? raw.slice(PRESET_PREFIX.length)
		const refAlpha = ref?.alpha ?? 100
		try {
			const all = await resolvePresets({ memoKey, req, source: presets })
			const match = all.find((preset) => preset.key === key)
			return withAlpha(shape(match ? match.value : linkedFallback), refAlpha, req)
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
			return withAlpha(shape(linkedFallback), refAlpha, req)
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
