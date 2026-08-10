import type { SelectOption } from './types'

export const OPERATION_OPTIONS: SelectOption[] = [
	{ label: 'Create', value: 'create' },
	{ label: 'Update', value: 'update' },
	{ label: 'Delete', value: 'delete' },
	{ label: 'Auth', value: 'auth' },
	{ label: 'Custom', value: 'custom' },
]

export const AUTH_EVENT_OPTIONS: SelectOption[] = [
	{ label: 'Login', value: 'login' },
	{ label: 'Forgot password', value: 'forgot_password' },
]
