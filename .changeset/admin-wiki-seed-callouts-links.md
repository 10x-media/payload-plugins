---
'@10x-media/admin-wiki': patch
---

Seeded callouts keep their line breaks, and guide links inside them resolve.

- Fixed: a multi-line GitHub alert seeded as one run of glued-together words. Payload's blockquote markdown transformer splices each `> ` continuation line onto the quote before it with nothing in between, so `> Draft first.\n> Publish after review.` imported as `Draft first.Publish after review.`. The wiki editor now registers Lexical's own `QUOTE` transformer in its place, which is the same code with the line break it forgets.
- Fixed: a `{{wiki:guide:slug}}` placeholder inside a callout was left behind, because the transformer walked only the outer tree and the alert had already moved the content into the callout block's own editor state. In the `[words]({{wiki:guide:slug}})` form that surfaced as an ordinary link pointing at the raw placeholder. Block fields are now walked too, and callout bodies render and accept guide links.
- A placeholder still left anywhere after every transformer has run now fails the seed, naming the guide and the placeholder, rather than saving a guide that reads wrong. Inline code is exempt, so a guide can spell the syntax out while documenting it.
