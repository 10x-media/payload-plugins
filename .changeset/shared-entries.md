---
'@10x-media/admin-wiki': minor
'@10x-media/analytics': minor
'@10x-media/audit-logs': minor
'@10x-media/content-lock': minor
'@10x-media/conversations': minor
'@10x-media/dual-session': minor
'@10x-media/form-builder': minor
'@10x-media/form-variants': minor
'@10x-media/jobs': minor
'@10x-media/settings-overlay': minor
---

A new `./shared` entry exports the helpers with no server and no React dependency (key formats and parsers, constants, error names and guards, formatters), for a host module that both server code and client components import. On Payload 4 the browser build of `payload` is `payload/shared`, so a client bundle that reaches the root fails on `definePlugin` and the Local API, and a server caller of a `'use client'` entry gets a client reference instead of the function. The root and the client entries keep exporting the same helpers.
