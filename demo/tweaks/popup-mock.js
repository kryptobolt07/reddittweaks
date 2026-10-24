/* Disposable fixture state. This page has no extension/private storage access. */
const fixtureSettings={'rt-settings-v1':{postDiscovery:true,archiveDiscovery:true}};
window.chrome={storage:{local:{get:async key=>({[key]:fixtureSettings[key]}),set:async values=>Object.assign(fixtureSettings,values)}},runtime:{sendMessage:async request=>request.action==='stats'?{ok:true,stats:{messages:1200,rooms:40,approxBytes:300000}}:{ok:true}}};
