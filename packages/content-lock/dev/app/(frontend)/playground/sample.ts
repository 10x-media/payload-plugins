/** Minimal valid data for a playground write to a dev app entity. */
export const sampleData = (
	kind: 'collection' | 'global',
	slug: string
): Record<string, unknown> => {
	const stamp = new Date().toISOString()
	if (kind === 'global') {
		return { tagline: `Playground ${stamp}` }
	}
	if (slug === 'users') {
		return { email: `playground-${Date.now()}@example.com`, password: 'password' }
	}
	return { title: `Playground ${stamp}` }
}
