import type { ReactNode } from 'react'
import { prerender } from 'react-dom/static'

/** A tree's markup once every Suspense boundary in it has settled, as a finished load shows it. */
export const renderSettled = async (node: ReactNode): Promise<string> => {
	const { prelude } = await prerender(node)
	return new Response(prelude).text()
}
