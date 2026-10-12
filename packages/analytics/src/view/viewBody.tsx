import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import type { ImportMap } from 'payload'
import type { ReactNode } from 'react'
import type { ResolvedOptions } from '../core/options'
import { AnalyticsViewClient } from './AnalyticsViewClient'
import { hostCountryFlag } from './hostCountryFlag'
import type { AnalyticsViewClientProps } from './viewProps'

export interface ViewBodyArgs {
	resolved: Pick<ResolvedOptions, 'view' | 'countryFlags'>
	props: AnalyticsViewClientProps
	importMap: ImportMap
	/** Hears, once, that the host's flag component is a server component the view cannot draw. */
	warn?: (message: string) => void
}

/**
 * Host's `view.Component` or plugin's own, same props; a host body missing from import map falls
 * back to plugin's own. Keyed on scope so a tenant switch remounts instead of keeping old state.
 */
export const renderViewBody = ({ resolved, props, importMap, warn }: ViewBodyArgs): ReactNode => {
	const flag = hostCountryFlag(resolved.countryFlags, importMap, warn)
	const clientProps = flag ? { ...props, countryFlags: flag } : props
	const Body = resolved.view === false ? undefined : resolved.view.Component
	if (Body === undefined) {
		return <AnalyticsViewClient key={clientProps.scopeKey} {...clientProps} />
	}
	const DefaultBody = () => <AnalyticsViewClient {...clientProps} />
	return RenderServerComponent({
		Component: Body,
		clientProps,
		Fallback: DefaultBody,
		importMap,
		key: clientProps.scopeKey,
	})
}
