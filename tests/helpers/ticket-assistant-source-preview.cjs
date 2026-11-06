const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const sources=new Map([
    ['/source/shared.js',path.join(root,'ujg-shared-modules/llm-client.js')],
    ['/source/pico.js',path.join(root,'vendor/pico-1.4.0.amd.js')],
    ...['icons','fields','field-ui','profiles','draft','validation','creator','storage','api','ai','settings-ui','controller','ui','chat-tools','chat','chat-ui','main'].map(name=>['/source/'+name+'.js',path.join(root,'ujg-ticket-assistant-modules',name+'.js')])
]);
// The preview loads each source separately, with the checked-in Pico vendor.
// Neither the widget builder nor the runtime builder is invoked.
function sourcePreviewResponse(pathname) {
    if(pathname==='/') {
        const scripts=[...sources.keys(),'/source/aliases.js'].map(src=>'<script src="'+src+'" defer></script>').join('\n');
        return {contentType:'text/html; charset=utf-8',body:fs.readFileSync(path.join(root,'tests/browser/ticket-assistant-preview.html'),'utf8').replace('<script src="/ujg-ticket-assistant.runtime.js" defer></script>',scripts)};
    }
    if(pathname==='/source/aliases.js')return {contentType:'text/javascript',body:'define("_ujgTA_llmClient",["_ujgShared_llmClient"],function(client){return client;});define("_ujgTicketAssistantRuntime",["_ujgTA_main"],function(Gadget){return Gadget;});'};
    if(sources.has(pathname))return {contentType:'text/javascript',path:sources.get(pathname)};
    return null;
}
module.exports={sourcePreviewResponse};
