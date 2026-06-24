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