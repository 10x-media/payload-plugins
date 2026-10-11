import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import type { ImportMap } from 'payload'
import { getFromImportMap, isReactClientComponent } from 'payload/shared'
import type { ComponentType, ReactNode } from 'react'
import type { AnalyticsCountryFlags } from '../core/options'
import type { CountryFlagProps, HostCountryFlag } from './CountryFlag'

/** Configs whose server-component flag was already reported, so each warns once. */
const reported = new WeakSet<AnalyticsCountryFlags>()

export const SERVER_FLAG_WARNING =
	"analytics: countryFlags.Component is a server component, which the analytics view and the Analytics tab cannot draw, since they render their rows in the browser: they show no flags there. The dashboard widgets render it. Mark it 'use client' to show it everywhere."

/**
 * Host's flag component plus its `clientProps`, not an element: one reaching the browser before its
 * chunk is a lazy node, uncloneable. Null when not host-set, unmapped, or a server component.
 */
export const hostCountryFlag = (
	flags: boolean | AnalyticsCountryFlags | undefined,
	importMap: ImportMap,
	warn?: (message: string) => void
): HostCountryFlag | null => {
	if (typeof flags !== 'object') {
		return null
	}
	const Component = getFromImportMap<ComponentType<CountryFlagProps> | undefined>({
		importMap,
		PayloadComponent: flags.Component,
		schemaPath: 'countryFlags.Component',
	})
	if (!Component) {
		return null
	}
	if (!isReactClientComponent(Component)) {
		if (warn && !reported.has(flags)) {
			reported.add(flags)
			warn(SERVER_FLAG_WARNING)
		}
		return null
	}
	const props = typeof flags.Component === 'object' ? flags.Component.clientProps : undefined
	return { Component, ...(props === undefined ? {} : { props }) }
}

/** One row's flag on a server surface: the host's component given that row's `code`. */
export const renderRowFlag = (
	flags: AnalyticsCountryFlags,
	importMap: ImportMap,
	code: string
): ReactNode =>
	RenderServerComponent({ Component: flags.Component, clientProps: { code }, importMap })
