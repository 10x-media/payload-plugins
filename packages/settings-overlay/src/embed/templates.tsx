import { headers } from 'next/headers'
// The real module, reached under a name the bundler aliases straight to the file, past the
// package's own export map. See `real-templates.d.ts` and the setup instructions.
import {
	MinimalTemplate,
	DefaultTemplate as RealDefaultTemplate,
} from 'payload-next-templates-real'
import type { ComponentProps } from 'react'

export type { DefaultTemplateProps, MinimalTemplateProps } from 'payload-next-templates-real'
export { MinimalTemplate }

/**
 * Payload's `DefaultTemplate`, aware of where it is rendering.
 *
 * Needed only for a registered admin view you do not own. Your own views can read the
 * `settingsOverlayEmbed` server prop and skip the template themselves; somebody else's cannot be
 * asked to, and without this they draw a second sidebar and header inside the panel.
 *
 * Aliasing `@payloadcms/next/templates` to this module makes every view in the admin reach the
 * wrapper without knowing it. On a page request it is the real template. Inside a server
 * function it renders only its children, because a server function rendering a full admin view
 * can only be this plugin embedding one.
 *
 * The signal is the `next-action` request header, which Next sends on every server-function call
 * and never on a page load. Payload's own drawers render the edit and list views from server
 * functions, not this template, so there is nothing else to collide with.
 */
export async function DefaultTemplate(props: ComponentProps<typeof RealDefaultTemplate>) {
	const requestHeaders = await headers()
	if (requestHeaders.get('next-action')) {
		return <div className="settings-overlay__embedded-view">{props.children}</div>
	}
	return <RealDefaultTemplate {...props} />
}
