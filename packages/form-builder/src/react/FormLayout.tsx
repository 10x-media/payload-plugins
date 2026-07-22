'use client'

import type { ReactNode } from 'react'
import { cn } from './cn'

export type FieldWidth = 'full' | 'half' | 'third' | 'twoThirds'

export type FormLayoutProps = {
	children: ReactNode
	/** When false, render a plain container with no grid class (document-order layout). */
	enabled?: boolean
	/** Extra class names merged onto the layout container. */
	className?: string
}

/** Establishes the layout container. With the stylesheet imported, children with `data-width` flow into a grid. */
export const FormLayout = ({ children, enabled = true, className }: FormLayoutProps) => (
	<div className={cn(enabled ? 'fb-form fb-form--grid' : 'fb-form', className)}>{children}</div>
)

/** Props to spread onto a field wrapper to declare its grid width. */
export const widthProps = (width: FieldWidth | undefined) => ({ 'data-width': width ?? 'full' })
