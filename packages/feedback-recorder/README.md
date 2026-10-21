# @10x-media/feedback-recorder

Let editors record their screen in the Payload admin, talk it through, and send it to the 10x Media system.

[![npm](https://img.shields.io/npm/v/@10x-media/feedback-recorder?style=flat-square)](https://www.npmjs.com/package/@10x-media/feedback-recorder)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Features

- A record button in the admin header: screen, microphone and an optional camera bubble, kept running while the editor navigates.
- Review before sending, with a title, a note and what the recording is about; a failed upload keeps the recording and resumes.
- Sends the page, document, browser and site version with each recording; console errors on request.
- The site's key stays on the server; the video goes straight from the browser to Bunny Stream.
- "My recordings" shows editors where each recording stands with the team.
- The recording engine on its own, without Payload, at `@10x-media/feedback-recorder/recorder`.

## Quick start

```bash
pnpm add @10x-media/feedback-recorder@beta
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { feedbackRecorder } from '@10x-media/feedback-recorder'

export default buildConfig({
  plugins: [
    feedbackRecorder({
      url: process.env.TENX_RECORDINGS_URL,
      apiKey: process.env.TENX_RECORDINGS_KEY,
    }),
  ],
})
```

The key comes from **Settings → Clients → Recording keys** in the 10x system.

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/feedback-recorder):

- [Overview](https://docs.10xmedia.de/feedback-recorder)
- [Quick start](https://docs.10xmedia.de/feedback-recorder/quick-start)
- [Configuration](https://docs.10xmedia.de/feedback-recorder/configuration)
- [How it works](https://docs.10xmedia.de/feedback-recorder/how-it-works)
- [Privacy](https://docs.10xmedia.de/feedback-recorder/privacy)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
