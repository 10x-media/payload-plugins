/**
 * A named tab presented as the group it already is in the data.
 *
 * Payload gives a named tab a data path, form state entries and nested permissions exactly as
 * it gives them to a named group; the only difference is where the config keeps it, as a member
 * of a `tabs` field rather than a field of its own. Nothing can render a tab directly for that
 * reason, so a step that lists one renders this instead, at the tab's own path and schema path.
 */
export const tabAsGroup = <T extends { name: string }>(tab: T): { type: 'group' } & T => ({
	...tab,
	type: 'group',
})
