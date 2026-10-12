/**
 * The storage key a prerendered page writes once its tracker booted, which the `/prerender` page
 * that asked for it shows in its title for the e2e lifecycle suite. In a module of its own because
 * a server component importing it from a client module would get a reference, not the string.
 */
export const PRERENDER_READY_KEY = 'analytics-dev:prerender-ready'

/** The title `/prerender` takes once the page at `pathname` it prerenders is ready. */
export const prerenderReadyTitle = (pathname: string): string => `Ready ${pathname}`
