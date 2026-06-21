---
'@10x-media/form-builder': minor
---

Add file uploads: a `file` field backed by a configurable, opt-out `form-uploads` upload collection; server-enforced MIME/size/required at the submit trust boundary (the client submits only the upload id, the server captures an authoritative self-describing `FileRef` from the stored doc); a headless file renderer plus a shadcn parity renderer and the `uploadFile` client helper; and a download link for file answers in the admin submission view.
