import { SCOPE_WILDCARD, type ScopeSelection } from './types'

const SEPARATOR = '::'

/** Internal broker key for a public topic under a scope. */
export const scopedTopic = (scope: string, topic: string): string => `${scope}${SEPARATOR}${topic}`

/** Strip a scope prefix written by {@link scopedTopic}. Unprefixed topics pass through. */
export const publicTopic = (brokerTopic: string): string => {
	const index = brokerTopic.indexOf(SEPARATOR)
	return index === -1 ? brokerTopic : brokerTopic.slice(index + SEPARATOR.length)
}

/** Broker subscribe keys for a collection-wide public topic under a resolved selection. */
export const toBrokerChannels = (
	selection: Exclude<ScopeSelection, null>,
	topic: string
): string[] => {
	if (selection === SCOPE_WILDCARD) {
		return [scopedTopic(SCOPE_WILDCARD, topic)]
	}
	const scopes = Array.isArray(selection) ? selection : [selection]
	return scopes.filter((scope) => scope.length > 0).map((scope) => scopedTopic(scope, topic))
}
