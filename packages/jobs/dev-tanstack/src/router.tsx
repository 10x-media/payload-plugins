import { payloadParseSearch, payloadStringifySearch } from '@payloadcms/tanstack-start/shared'
import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

const notFoundStyle = { fontFamily: 'system-ui, sans-serif', padding: '2rem' }

function DefaultNotFound() {
	return (
		<div style={notFoundStyle}>
			<h1>404, page not found</h1>
			<p>The page you requested does not exist.</p>
		</div>
	)
}

export function getRouter() {
	return createRouter({
		defaultNotFoundComponent: DefaultNotFound,
		parseSearch: payloadParseSearch,
		routeTree,
		scrollRestoration: true,
		stringifySearch: payloadStringifySearch,
	})
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}
