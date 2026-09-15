/**
 * Parts of Payload's own edit view that `@payloadcms/ui` does not export, rebuilt here on its
 * class names and its translation keys.
 *
 * They cannot be imported from their subpaths. `@payloadcms/ui`'s package entry is a single
 * pre-bundled file with every provider module inlined into it, while a subpath such as
 * `@payloadcms/ui/elements/Status` resolves to the unbundled module graph next to it. The two
 * graphs each run `createContext()`, so a component reached through a subpath reads a second,
 * empty copy of every context the admin mounted through the entry: `useConfig()` comes back
 * `undefined` and the component throws. Subpaths that export plain functions
 * (`@payloadcms/ui/shared`, `@payloadcms/ui/utilities/*`) carry no context and stay fine.
 */
export { DrawerHeader } from './DrawerHeader'
export { StaleDataModal } from './StaleDataModal'
export { Status } from './Status'
