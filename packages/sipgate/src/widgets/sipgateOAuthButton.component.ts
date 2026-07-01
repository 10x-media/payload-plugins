import type { CustomComponent } from 'payload'

export const createSipgateOAuthButton = (): CustomComponent<Record<string, never>> => ({
	path: '@10x-media/sipgate/ui/SipgateOAuthButton',
})
