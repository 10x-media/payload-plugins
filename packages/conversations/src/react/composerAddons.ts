'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

/**
 * What an extension adds to a composer: files it takes, and its part of the
 * send. Registered with `useComposerAddon` from anything rendered inside the
 * composer (a slot, a website's own markup).
 */
export type ComposerAddon = {
	/** Files dropped on or pasted into the composer, or passed to `addFiles`. */
	onFiles?: (files: File[]) => void
	/**
	 * At send, once the optimistic message shows: this addon's part of `ext`
	 * (the server `send` hook of the extension with the same name reads it).
	 * Read the addon's state as it is now; `undefined` sends nothing.
	 */
	prepare?: (args: { clientId: string }) => Promise<unknown> | unknown
	/** The send went through and the editor cleared: drop what was picked. */
	reset?: () => void
}

export type ComposerAddons = {
	/** Some addon takes files: the composer accepts drops and pastes. */
	acceptsFiles: boolean
	/** Hands files to every addon that takes them, e.g. from a file picker button. */
	addFiles: (files: File[]) => void
	register: (name: string, addon: ComposerAddon) => () => void
}

export const ComposerAddonsContext = createContext<ComposerAddons | null>(null)

/** The addons of one composer, for `useComposer`. */
export const useComposerAddonRegistry = () => {
	const addons = useRef(new Map<string, ComposerAddon>())
	const [fileTakers, setFileTakers] = useState(0)
	const register = useCallback((name: string, addon: ComposerAddon) => {
		addons.current.set(name, addon)
		if (addon.onFiles) setFileTakers((count) => count + 1)
		return () => {
			if (addons.current.get(name) === addon) addons.current.delete(name)
			if (addon.onFiles) setFileTakers((count) => count - 1)
		}
	}, [])
	const addFiles = useCallback((files: File[]) => {
		if (files.length === 0) return
		for (const addon of addons.current.values()) addon.onFiles?.(files)
	}, [])
	const context = useMemo<ComposerAddons>(
		() => ({ acceptsFiles: fileTakers > 0, addFiles, register }),
		[addFiles, fileTakers, register]
	)
	/** Every addon's part of `ext`, or null when no addon prepares anything. */
	const prepare = useCallback(() => {
		const preparing = [...addons.current].filter(([, addon]) => addon.prepare)
		if (preparing.length === 0) return null
		return async ({ clientId }: { clientId: string }) => {
			const parts = await Promise.all(
				preparing.map(async ([name, addon]) => [name, await addon.prepare?.({ clientId })] as const)
			)
			return Object.fromEntries(parts.filter(([, value]) => value !== undefined))
		}
	}, [])
	const reset = useCallback(() => {
		for (const addon of addons.current.values()) addon.reset?.()
	}, [])
	return { context, prepare, reset }
}

/**
 * Adds to the composer around it: `prepare` puts this addon's data in the
 * send, `onFiles` takes dropped and pasted files. Name it after the
 * extension whose server `send` hook reads it. A no-op outside a composer.
 */
export const useComposerAddon = (name: string, addon: ComposerAddon) => {
	const context = useContext(ComposerAddonsContext)
	const latest = useRef(addon)
	latest.current = addon
	const takesFiles = Boolean(addon.onFiles)
	const prepares = Boolean(addon.prepare)
	const register = context?.register
	useEffect(() => {
		if (!register) return
		return register(name, {
			onFiles: takesFiles ? (files) => latest.current.onFiles?.(files) : undefined,
			prepare: prepares ? (args) => latest.current.prepare?.(args) : undefined,
			reset: () => latest.current.reset?.(),
		})
	}, [name, prepares, register, takesFiles])
}

/** The composer's file intake, for a picker button; null outside a composer. */
export const useComposerFiles = (): Pick<ComposerAddons, 'acceptsFiles' | 'addFiles'> | null => {
	const context = useContext(ComposerAddonsContext)
	return context ? { acceptsFiles: context.acceptsFiles, addFiles: context.addFiles } : null
}
