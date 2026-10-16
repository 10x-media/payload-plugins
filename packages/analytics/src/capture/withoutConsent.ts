import type { CaptureSupport, CookielessSupport, SnippetArgs } from '../core/capture'
import type { CaptureGateArgs, ResolvedWithoutConsent } from '../core/options'
import { isOneOf, kindOf } from '../core/values'
import type {
	ConsentPhase,
	HeldSlotMode,
	SlotWithoutConsent,
	WithoutConsentLevel,
} from '../tracker/config'

export const CONSENT_PHASES: readonly ConsentPhase[] = ['pending', 'refused']

export const WITHOUT_CONSENT_LEVELS: readonly WithoutConsentLevel[] = ['cookieless', 'off']

/** `capture.withoutConsent` left unset. */
export const DEFAULT_WITHOUT_CONSENT: Record<ConsentPhase, WithoutConsentLevel> = {
	pending: 'cookieless',
	refused: 'cookieless',
}

export interface HeldSlotArgs extends CaptureGateArgs {
	capture: Pick<CaptureSupport, 'cookieless' | 'withoutConsent'>
	/** `capture.withoutConsent` resolved; absent means unset. */
	option: ResolvedWithoutConsent | undefined
}

/**
 * A held slot's mode in one phase: the adapter's own setting, else the host's function, else the
 * install's level, where `'cookieless'` takes the adapter's declared default. A function that
 * throws or answers anything else is `off`, reported to `onError`, failing closed like the gate.
 */
export const heldSlotMode = (
	args: HeldSlotArgs & { phase: ConsentPhase },
	onError?: (err: unknown) => void
): HeldSlotMode => {
	const { capture, option, phase, slot, adapterId, kind } = args
	const support = capture.cookieless
	if (!support) {
		return 'off'
	}
	if (capture.withoutConsent !== undefined) {
		return capture.withoutConsent
	}
	if (typeof option === 'function') {
		try {
			const answer: unknown = option({ slot, adapterId, kind, phase })
			if (isOneOf(WITHOUT_CONSENT_LEVELS, answer)) {
				return answer
			}
			onError?.(new Error(`it answered ${kindOf(answer)}, not 'cookieless' or 'off'`))
		} catch (err) {
			onError?.(err)
		}
		return 'off'
	}
	const level = (option ?? DEFAULT_WITHOUT_CONSENT)[phase]
	return level === 'off' ? 'off' : (support.default ?? 'cookieless')
}

/**
 * A held slot's modes without consent, or undefined when both are `off`: such a slot's config is
 * exactly 1.0.0-beta.14's.
 */
export const slotWithoutConsent = (
	args: HeldSlotArgs,
	onError?: (err: unknown) => void
): SlotWithoutConsent | undefined => {
	const pending = heldSlotMode({ ...args, phase: 'pending' }, onError)
	const refused = heldSlotMode({ ...args, phase: 'refused' }, onError)
	return pending === 'off' && refused === 'off' ? undefined : { pending, refused }
}

/**
 * What a slot's snippet is rendered for: a held slot that may count without consent starts
 * cookieless and switches up on consent; every other slot gets 1.0.0-beta.14's snippet.
 */
export const snippetModeArgs = (
	withoutConsent: SlotWithoutConsent | undefined
): Pick<SnippetArgs, 'mode' | 'withoutConsent'> =>
	withoutConsent
		? { mode: 'cookieless', withoutConsent: true }
		: { mode: 'full', withoutConsent: false }

/**
 * What the full variant of a slot counting without consent is rendered for, which a server-known
 * grant renders; undefined for every other slot, whose one snippet is already full.
 */
export const fullSnippetArgs = (
	withoutConsent: SlotWithoutConsent | undefined
): Pick<SnippetArgs, 'mode' | 'withoutConsent'> | undefined =>
	withoutConsent ? { mode: 'full', withoutConsent: true } : undefined

/**
 * An adapter factory's `withoutConsent` (`at` names it, such as `plausible({ withoutConsent })`),
 * refused at boot unless it is one of `allowed`.
 */
export const adapterWithoutConsent = <T extends HeldSlotMode>(
	value: unknown,
	at: string,
	allowed: readonly T[]
): T | undefined => {
	if (value === undefined || isOneOf(allowed, value)) {
		return value
	}
	const names = allowed.map((level) => `'${level}'`)
	throw new Error(
		`analytics: ${at} must be ${names.slice(0, -1).join(', ')} or ${names.at(-1)}, got ${kindOf(value)}`
	)
}

/** The `capture` fields an adapter able to count without consent declares, its own setting included. */
export const cookielessCapture = (
	cookieless: CookielessSupport,
	withoutConsent: HeldSlotMode | undefined
): Pick<CaptureSupport, 'cookieless' | 'withoutConsent'> => ({
	cookieless,
	...(withoutConsent === undefined ? {} : { withoutConsent }),
})
