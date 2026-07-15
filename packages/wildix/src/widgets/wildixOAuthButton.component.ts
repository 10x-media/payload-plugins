import type { CustomComponent } from 'payload'

export const createWildixOAuthButton = (): CustomComponent<Record<string, never>> => ({
	path: '@10x-media/wildix/ui/WildixOAuthButton',
})
