---
'@10x-media/feedback-recorder': minor
---

Initial beta of `@10x-media/feedback-recorder`: editors record their screen in the Payload admin and send it to the 10x Media system.

- **Recording**: screen, microphone and an optional camera bubble placed against the real shared screen, in one video. A header button opens the recorder; a small bar pauses, stops or discards; the recording survives navigating the admin.
- **Review and send**: watch it back, pick what it is about, add a title and a note. A failed send keeps the recording and the reservation, so retrying resumes the upload; a copy can be saved at any time.
- **Context**: the page, collection and document, browser, language, time zone, screen size and site version go with each recording; console errors with `captureConsole`.
- **Server-side key**: the plugin's endpoints forward to the 10x ingest API with the site's recording key and take the submitter from the session. The video goes straight from the browser to Bunny Stream over tus.
- **My recordings**: editors see what they sent and where it stands with the team.
- **Recorder entry**: `@10x-media/feedback-recorder/recorder` is the recording engine without Payload, with an injectable transport.
- English and German translations.
