V1 Plugin features:

1. get call notifications. 
2. take calls via your phone by button. 
3. call someone from the contact field directly. 
4. sync call logs with payload. 
5. saving contacts in payload and optional syncing with sipgate (rest api).
		Harder, because the contacts collection will be designed to be created by the user and can be any collection. Also an employee collections. Only prerequisite is a phone number field. So we could sync TO sipgate, but not FROM sipgate. 
6. manipulate running calls: hold, mute, hangup. 

For that we need:
1. rest api utils. 
2. push api webhooks handlers. 
3. ui component for phone numbers. 
4. ui component for floating widget for taking and listing all calls. 


V2 Plugin: WebRTC live call in widget. 
1. this is damn tricky. 
2. WebRTC infrastructure. Probably Peer to Peer only option? As we would need a redistribution server to route it over custom infrastructure. 

API Design:
1. Dial: create a call. 
CLASSIC: POST /sessions/calls
{
  "callee": "+4915799912345", The one who gets called
  "caller": "e0", the one who calls (can be phone number or deviceId)
  "callerId": "+4915799912345", to set a custom number that gets displayed to the callee
  "deviceId": "e0" set if caller is phone number. 
}

NEO: POST /calls
{
  "additionalDevices": [ The devices to be connected to the call. 
    {
      "deviceId": "e1"
    }
  ],
  "callerId": "4915790123456", to set a custom number that gets displayed to the callee
  "channelId": "0982524d-1328-4830-89d8-a295f200e90e",
  "deviceId": "e0",
  "targetNumber": "4915790123456"
}

2. Hang Up Running Call:
DELETE /calls/{callId}

3. HOLD call:
PUT /calls/{callId}/hold

4. MUTE call:
PUT /calls/{callId}/muted

Flow for taking a call:
1. webhooks fire and sets the call in kv index. 
2. poll picks it up and displays it in the ui. 
3. user accepts call. 
4. gets the callId. 
5. if classic: use /sessions/calls to create a new call and use callId as the caller
If neo: use /calls and create a new call in the channel that gets called. 

Flow for making a call:
if classic: use /sessions/calls to create a new call. 
If neo: use /calls and create a new call in the channel that gets called. 

Update: v2 scrapped. Implementing webrtc and live calling in thsi plugin is exceptionally hard and complicated to set up. 
It will have more value to actually implement the rest of the features that sipgate provides, to allow users to for example 
play audio files hosted with their payload instance for custom IVR system messages. 
Falls web rtc live call gewünscht. mögliches beispiel: https://github.com/fnordian/sipgate-webrtc/blob/master/templates/webrtc.html

Features to build: 
Extensible Custom IVR system support. 
Call Statistics dashboard (with possible real time call statistics).
Slack integration.  

ivr setup: https://en.sipgate.io/blog/create-complex-ivrs-for-your-crm
collection für ivr-nodes. 
payload.kv für current ivr status (aktuelles system erweiterbar)
media collection für ivr voice files wäre cool. 
routing über zielrufnummer: wenn eine rufnummer der des ivr access points entspricht, ivr starten. 
bypass für direkte user-durchwahlen: webhook liefert leeres xml, sipgate übernimmt standard-routing ans endgerät.
--> notwendig ist eine xml factory für simple responses. vermutlich ist nun sogar die sipgateio-node bibliothek nützlich. 
--> umstieg vermutlich ziemlich simpel. client based, also eig nicht unbedingt für next mit payload gemacht. 