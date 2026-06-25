The document should include:
1. What the Sipgate API makes possible
- Click to call
- Incoming call synchronization
- Outgoing call synchronization
- Call history
- Contact matching
- SMS, if relevant
- Webhooks or push events
- Authentication options

2. Possible Payload plugin architecture
- Which collections are needed
- Which endpoints are needed
- How credentials should be configured
- How calls should be triggered from the Payload admin dashboard
- How Sipgate events should be synchronized back into Payload

3. Possible implementation approaches
- Minimal MVP
- More complete version
- Optional future features

4. Technical risks and open questions
- API limitations
- Authentication complexity

5. Recommended implementation path
- What should be built first
- What should be postponed
- Why this approach is recommended

Notes:
1. The Web App, Phone Apps get NOT counted as device, you will have to GUESS the device id. Workaround would be to probe all devices in sequence and then see if it exists in the /devices endpoint, if not, its an Web App/ App, if it does, its data can be gotten from the devices listing. 
2. since last year I believe they have 2 user account types: classic pbx and neo pbx. We need to make the plugin work for both. Its in most cases pretty clear, but hard to test, as we dont have a classic pbx account anymore. So the most relevant will be the neo account for the plugin. We should add a feature flag for: supportsExperimentalClassicAccount type, to add it in the plugin setup. Its btw very hard to see if an account is a classic or neo account programmatically. So thats also a setting we need to add in the plugin settings, probably jsdocs should say that its experimental mode or alpha mode. 
3. current implementation has no real access concept. TBD. 
4. do we use sipgateio-node package? Rn all is custom with fetch. Simple and customizable. But as more features get used, package might be the best option for simple typing and interactions with the rest api. 
5. API rate limits need to be researched. 
6. webhooks could be spoofed. Is there any way to secure it with cryptographic headers?
7. what happens when a webhook delivery fails? The call woul dbe stale. How do we remove it? We coul use the active calls rest api endpoint?
8. It seems like Web Apps cant be the starting point for a call initiation via the rest api, hence why they are excluded from the /devices endpoint. 


1. What does the API support?
- account information (useful for displaying in an account overview and seeing the account balance)
- list addresses and appropriate phone numbers for them
- 0Auth2 Authorization flow (But I honestly think that PAT is the way more uncomplicated approach, oAuth2 could be a version 2 feature)
- blacklist management
- contacts management (getting, saving, editing, export csv, import csv)

- devices management (important for plugin: Idea is exposed fields you can add to a user (automatically by providing user collections or for plugin users to use and then to use that field to store the users devices. The plugins dial feature will get a ui improvement with payload modal, to select a device to call with/ from))
- devices can be scoped by userId. 
- the classic account uses phonelines api that basically is the same, justwith different responses.

- groups (basically channels for neo users) for call groups. (Needs more research, hard to find any concrete informations for)
- call history by /history. Usable for all old classic accounts. For new ones, qou would query channels and get events from there. (relevant for synching call history) 

(also smth to consider: there is a webhooks log, that would probably contain a call history)
{
  "items": [
    {
      "created": "2015-10-21T19:28:00Z",
      "pushApiVersion": 2,
      "request": "event=newCall&from=492111234567&to=4915791234567&direction=in&callId=123456&user[]=Alice",
      "response": "HTTP/1.1 200 OK...",
      "status": "200",
      "url": "https://demo.sipgate.io",
      "xmlError": "Response does not have content type application/xml"
    }
  ]
}

- notifications: need more research, I dont know yet what that are yet. Probably good to query it for tests and see what comes back. The api lets you CREATE email and sms notifications for reports.
- numbers management (phone numbers) (for employees) You can add quickdialing, change number settings etc. List numbers by user. 

- real time call manipulation (rtcm): announcements, dtmf, hold, mute, record, take/ make calls, list all active calls, transfer a call.
- classic account uses /sessions to make any calls, send sms, faxes, etc
- update sipgateio settings to update webhook urls per api. could be useful for an auto setup mode for the plugin. 
- sms management (seems to use /sessions/sms for both account types)(has userId/sms endpoints for management)
- users management endpoints to edit, create and delete users. 

webhooks: newCall, Answer (Call), hangup (Call). See implementation. 


2. Plugin Architecture:
- only one collection, for call history. 
- any other collection of the user can be a contact. The plugin adds the phone number dial button to any phone number field of the contact collections. (our own contact collection would maybe make sense if we want to sync them with sipgate and we could provide helpers for the api to use for custom syncing solutions. A new contacts collection for a quick setup is not hard to achieve and build on the current implementation)

- endpoints for: webhooks from sipgate, interactions from ui components like getting active call info, rtcm controls, dialing. (using payload kv as active call and staus cache)

- we can provide credentials as PAT (simple) or OAuth2 (I would say version 2), PAT can do everything. 

- How calls should be triggered from the Payload admin dashboard:
1. the best way for version 1 is to use the rest api to make a device call the contact. 
2. one might consider an webrtc implementation. But thats honestly really hard. Needs websockets, STUN/ TURN Servers, might need a traffic routing server. Its def nothing for a week and needs serious investigation, infrastructure and planning. MAYBE version 3. 

- How Sipgate events should be synchronized back into Payload: use webhooks for live events. And the call history rest api for logs syncing. 
- I would propose a jobs based syncing with a sync task. Need to ask harley how that would be used with the jobs plugin. 

3. Possible implementation approach
Minimum MVP: use one channel and one device id (or device discovery with dropdown for select what device to use)
1. working calling from a phone number field. 
2. working webhook events and call management (accept, rtcm) (call management via floating widow (rn with polling, maybe using tanstac query for better UX))
3. contact matching (if we want to implement our own contact collection in the plugin with overrides)
4. call history syncing. 
5. device management per dropdown.
-> for both account types. 

More complete: more better channel management, device management and per payload user channel and device assignment (1 to many).  
1. IVR System. 
2. Call Statistics. 
3. Integrations with Third Party like Slack. 
4. oauth2 integration. 
5. device and chanel management (collections? as this data changes very infrequent with manual sync buttons) (how would it handel delete of a channel or device with a user still assigned? probbly jst remove from user before delete). 
6. Number Pad to dial number directly in payload. 

For the future:
1. In App call via webrtx conection, guide for setting up infrastructure, straight forward plugin configuration. 

Technical details:
- CallLogs collection. (overridable)
- possible out of the box Contact Collection. (overridable/ deactivatable)
- Injecting payload endpoins in config. 
- using custom ui for phone number field. 
- using custom ui for active calls management, 
- using widgets for call history list on dashboard, 
- using widgets for live call statistics on dashboard.
- using tanstack query for better UX for live call state management and loading states across pages. 
- using utils for rest api, kv store management.  

4. risks and questions
- api is messy. Do we even want to support classic accounts? all new accounts are neo either way. and there is a free migration for classic to neo accounts too. 
- authentication is pretty good documented. No risk there. Only implementation work. 
- default access control and localization missing from current implementation.  

The current implementation:
1. working calling from a phone number field. 
2. working webhook events and call management (accept, rtcm) (call management via floating widow (rn with polling, maybe using tanstac query for better UX))
3. call history syncing. (not tested, I hv no call history :() 
-> for both account types. not tested for classic. 