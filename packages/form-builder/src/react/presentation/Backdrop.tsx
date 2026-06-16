'use client'

import { createElement } from 'react'

export type BackdropProps = {
	onClick?: () => void
	className?: string
}

/** A full-viewport backdrop behind an overlay surface. Styling comes from the `data-fb-backdrop` hook. */
export const Backdrop = ({ onClick, className }: BackdropProps) =>
	createElement('div', { 'data-fb-backdrop': '', className, onClick, 'aria-hidden': true })
