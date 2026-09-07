/** Where the plugin parks its full config. `custom` is in Payload's server-only properties. */
export const REGISTRY_KEY = '@10x-media/settings-overlay'

/** Which overlay is open and what it points at: `<overlay>/<item>[/<id>]`. */
export const SEARCH_PARAM = 'settings'

/** The open list's query, as JSON, beside `settings`. Namespaced so the page never reads it. */
export const QUERY_PARAM = 'settingsQuery'

/**
 * Slug of the widget the plugin registers to reach `render-widget`. Namespaced with the
 * package name so it cannot collide with a host's own widget.
 */
export const DISPATCHER_WIDGET_SLUG = '@10x-media/settings-overlay:item'

/**
 * Name of the plugin's own server function, used only under `lazyTransport: 'server-function'`.
 * Namespaced with the package name because it lands beside Payload's own.
 */
export const LAZY_FUNCTION_NAME = '@10x-media/settings-overlay:render-item'

export const PROVIDER_PATH = '@10x-media/settings-overlay/rsc#SettingsOverlayServer'
export const DISPATCHER_PATH = '@10x-media/settings-overlay/rsc#SettingsOverlayItemDispatcher'
export const REPORTER_PATH = '@10x-media/settings-overlay/client#SettingsFormModifiedReporter'
export const BUTTON_PATH = '@10x-media/settings-overlay/client#SettingsOverlayButton'

/** Prefix for the `admin.dependencies` entries the plugin creates for configured components. */
export const DEPENDENCY_PREFIX = 'settings-overlay'

/**
 * Where the reader's collapsed rail groups live. The plugin's own key rather than Payload's
 * `nav`, so a panel group and a sidebar group of the same name cannot collapse each other.
 */
export const PREFERENCE_KEY = 'settings-overlay'

/** Every faceless-ui modal slug the plugin owns derives from this. */
export const panelSlugFor = (overlayId: string): string => `settings-overlay_${overlayId}`

export const DISCARD_SLUG = 'settings-overlay__discard'
