---
'@10x-media/form-builder': patch
---

Fix a multi-step focus race: submitting right after a step change could leave focus on the previous step's region, or nowhere, instead of on the first invalid field the form routed back to. React can run a render's effect late, just before the next render, and the late effect was acting on the newer request against DOM that did not contain its target. Each focus request is now handled only by the render it triggered.
