'use client'

import { Form, type FormProps } from '@10x-media/form-builder/react'
import { shadcnRenderers } from './renderers'

/** `<Form>` preconfigured with the shadcn-styled renderers. Consumer `renderers` overrides merge on top. */
export function FormBuilderForm({ renderers, ...props }: FormProps) {
	return <Form {...props} renderers={{ ...shadcnRenderers, ...renderers }} />
}
