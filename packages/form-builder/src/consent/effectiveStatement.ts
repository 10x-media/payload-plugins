import { textOfBody } from '../actions/body/textOfBody'
import type { ConsentSourceEntry } from './types'

/** How a consent field presents itself: a box to tick, or a passive notice the submit agrees to. */
export type ConsentDisplay = 'checkbox' | 'notice'

/** A consent field instance's display, defaulting anything but an explicit `'notice'` to `'checkbox'`. */
export const consentDisplayOf = (field: unknown): ConsentDisplay =>
	(field as { display?: unknown } | null | undefined)?.display === 'notice' ? 'notice' : 'checkbox'

/**
 * The wording a consent field shows for its display: the source's `noticeStatement` for a notice
 * (falling back to `statement` when it is absent or empty), the `statement` for a checkbox. Both
 * the render path (`resolveConsentStatements`) and the proof path (`captureConsent`) select
 * through this one function, which is what guarantees the snapshot attests to the wording the
 * visitor actually saw.
 */
export const effectiveConsentStatement = (
	entry: Pick<ConsentSourceEntry, 'statement' | 'noticeStatement'>,
	display: ConsentDisplay
): unknown =>
	display === 'notice' && textOfBody(entry.noticeStatement).trim().length > 0
		? entry.noticeStatement
		: entry.statement
