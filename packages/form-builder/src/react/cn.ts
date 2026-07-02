'use client'

/** Joins class names, filtering out falsy values. */
export const cn = (...classes: (string | undefined | null | false)[]): string =>
	classes.filter(Boolean).join(' ')
