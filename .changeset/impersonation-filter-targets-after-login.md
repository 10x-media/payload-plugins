---
'@10x-media/impersonation': patch
---

The switcher, the document button and `useImpersonation().targetFilters` follow `access.filterTargets` right after login and after switching accounts in the same tab. Before, they kept the filters resolved on the signed-out login page until the next full reload, so a user the filter excludes still saw the switcher. The plugin now also registers a header component, `ImpersonationTargetsHeader`, that renders nothing visible. Upgrade: run `pnpm payload generate:importmap`, so the admin renders the header component.
