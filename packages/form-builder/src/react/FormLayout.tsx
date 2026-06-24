'use client'

import type { ReactNode } from 'react'

export type FieldWidth = 'full' | 'half' | 'third' | 'twoThirds'

export type FormLayoutProps = {
	children: ReactNode
	/** When false, render a plain container with no grid class (document-order layout). */
	enabled?: boolean
}

/** Establishes the layout container. With the stylesheet imported, children with `data-width` flow into a grid. */
export const FormLayout = ({ children, enabled = true }: FormLayoutProps) => (
	<div className={enabled ? 'fb-form fb-form--grid' : 'fb-form'}>{children}</div>
)

/** Props to spread onto a field wrapper to declare its grid width. */
export const widthProps = (width: FieldWidth | undefined) => ({ 'data-width': width ?? 'full' })
