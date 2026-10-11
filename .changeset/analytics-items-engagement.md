---
"@10x-media/analytics": minor
---

**Content items, engagement and what the tracker counts.** An offer, a banner or a product card can have analytics of its own; time on page and scroll depth are measured for the whole visit rather than its first seconds; and the tracker leaves out what is not a visit ([Content items](https://docs.10xmedia.de/analytics/items), [Time on page and scroll depth](https://docs.10xmedia.de/analytics/native#time-on-page-and-scroll-depth)).

**Upgrade actions**

1. Code with an exhaustive `Record` or `switch` over `MetricKey` or `DimensionKey` adds `impressions`, `interactions` and `visitDuration`, and `currency` and `item`. Both unions may grow again in a minor release.
2. Code that implements `Tracker` itself accepts the third argument of `track` (and adds `purchase`, `refund`, `setGate` and `gate`, which the revenue and consent entries describe).
3. An end-to-end suite that asserts on captured hits from an automated browser sets `capture.skip: { automation: false }`.
4. To use items: bind a collection with `collections: { offers: { item: true } }`, mark the element that renders a document with `itemAttributesFor(payload, { collection, id, name })` or a ref from `signItemRef`, and regenerate the import map.

**Breaking:** `MetricKey` gains `impressions`, `interactions` and `visitDuration`, and `DIMENSION_KEYS` gains `currency` and `item`. `ResolvedAutoCapture` gains a required `items`, `AnalyticsBinding` an optional `item`, and `Tracker['track']` an optional third argument, `{ item }`.

**Behavioral:** the tracker sends a pageview the moment a page is tracked instead of holding it for up to ten seconds, so time on page and scroll depth are no longer capped at that moment. What the visitor does afterwards follows as an `engagement` message when the tab is hidden, the page is left or a single-page app moves on: the visible time (at most 30 minutes per message) and the extra scroll since the previous one. It is never counted as a pageview, event, visit or visitor, never reaches a vendor slot, and is filed on its pageview's day. Ingest drops a `durationMs` or `scrollDepth` sent on an event or a goal. **Active right now** reacts faster, since a visit counts from its first moment.

**Behavioral:** a page the browser only prerenders sends nothing and loads no vendor script until it is shown, then one pageview for wherever it is.

**Behavioral:** a form carrying `data-analytics-goal` or `data-analytics-event` counts its submit alone, once per submission: a click inside it no longer completes the goal, and an element tagged around a form no longer counts again on the form's submit ([Tag the element](https://docs.10xmedia.de/analytics/goals#1-tag-the-element)).

**Behavioral:** browsers reporting `navigator.webdriver`, Next draft mode pages and Payload's live preview are not counted; `capture.skip: { automation: false, previews: false }` counts them ([Pages that are not counted](https://docs.10xmedia.de/analytics/capture#pages-that-are-not-counted)).

**Behavioral:** `initTracker()` resolves the window's one tracker, shared with `AnalyticsScripts`, `AnalyticsProvider` and `useAnalytics`, and its `destroy` gives its hold back. A destroyed tracker stays quiet even when another library wrapped the history API over it.

**Additive:** content items. `collections.<slug>.item` binds a collection's documents as items; the tracker counts an item seen once at least half of it stays on screen for a second in a tab in front, sends `item_click` for the first click inside one per pageview, and credits a goal or event fired inside it. Refs a page sends carry the server's signature unless `native({ items: { signature: 'optional' } })`. `track(name, props, { item })`, `trackGoal(slug, { item })`, `purchase({ item })` and `item` on the server calls file an event under an item. `capture.autoCapture.items` turns any part off. The Analytics tab of an item reads **Views**, **Viewers**, **Clicks**, **Click rate**, **Conversions** and the pages it was seen on (`report: 'auto' | 'item' | 'page'` on `analyticsTab` and the stat fields), the analytics view gains a **Content** tab, and the query endpoint takes `item=<ref>` on a source declaring `capabilities.perItemQuery`. Vendors receive `item_click` (GA4 as `select_promotion`) and an item's id and name on goals and events.

**Additive:** the dependency-free `@10x-media/analytics/attributes` entry: `goalAttributes()`, `eventAttributes()`, `itemAttributes()`, `itemRef()`, the attribute names and the event names, for marking up a link, a Lexical converter or a shared component without loading Payload. Auto-capture reads `data-analytics-event` and `data-analytics-prop-*` beside the goal attributes, and `analyticsLinkFields()` adds a goal picker to any link field ([Integrations](https://docs.10xmedia.de/analytics/integrations)).
