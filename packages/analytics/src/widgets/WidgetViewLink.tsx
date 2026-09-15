import { linkStyle } from './cardChrome'

/**
 * A built-in widget's footer link into the analytics view. Renders nothing without an
 * href, which is how a widget carries "the app turned the view off" through to the markup.
 */
export const WidgetViewLink = ({ href, label }: { href?: string; label: string }) =>
	href === undefined ? null : (
		<a className="analytics-widget__link" href={href} style={linkStyle}>
			{label}
		</a>
	)
