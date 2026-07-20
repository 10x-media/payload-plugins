/** Cosmetic dot count shown while an encrypted field is concealed. */
export const DEFAULT_MASK_DOTS = 8

const MIN_MASK_DOTS = 1
const MAX_MASK_DOTS = 64

/**
 * Normalizes a factory `maskDots` option to an integer in [1, 64]. The count is
 * purely cosmetic (it is decoupled from the real value length, which is unknown
 * until reveal), so an out-of-range or non-integer value is clamped rather than
 * rejected. `undefined` and `NaN` fall back to the default.
 */
export const clampMaskDots = (value?: number): number => {
	if (value === undefined || Number.isNaN(value)) {
		return DEFAULT_MASK_DOTS
	}
	return Math.min(MAX_MASK_DOTS, Math.max(MIN_MASK_DOTS, Math.trunc(value)))
}
