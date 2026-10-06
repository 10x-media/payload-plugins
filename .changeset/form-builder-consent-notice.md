---
'@10x-media/form-builder': minor
---

Consent fields gain a Display setting: `checkbox` (the default, unchanged) or `notice`, which renders the statement as passive prose with no control, for flows where submitting is the opt-in ("By subscribing, you agree to our privacy policy"). The server records `agreed: true` on a notice proof regardless of the client payload, `required` is ignored for notices, and the proof carries `display: 'notice'` so audits distinguish the two. `consentSourcesField` rows gain a `noticeStatement` rich text beside `statement`, so one source phrases each presentation naturally while keeping one policy, one version, and one id in every proof; a notice field falls back to `statement` when it is empty. Whichever wording renders is exactly what the proof snapshots, selected through one shared function on both paths.
