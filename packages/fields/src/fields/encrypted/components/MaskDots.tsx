'use client'
import type React from 'react'

const BULLET = '•'

/** A run of `count` bullet characters, for input `value` attributes. */
export const dotString = (count: number): string => BULLET.repeat(Math.max(0, Math.trunc(count)))

/**
 * Decorative dot run for non-input concealed faces (select value, radio label,
 * code/json boxes). Hidden from assistive tech: the surrounding native markup
 * already carries the field label, and the eye carries the action.
 */
export const MaskDots: React.FC<{ className?: string; count: number }> = ({ className, count }) => (
	<span
		aria-hidden="true"
		className={['tenx-protected-field__dots', className].filter(Boolean).join(' ')}
	>
		{dotString(count)}
	</span>
)
