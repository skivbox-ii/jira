const {JSDOM}=require('jsdom');
const jquery=require('jquery');
const {loadUnit}=require('./ticket-assistant-fixture');
const {harness}=require('./ticket-assistant-chat-fixture');
async function liveFixture(t,{legacy=false}={}) {
    const h=await harness(),dom=new JSDOM('<div id="root"></div>',{url:'https://jira.test/'}),window=dom.window,$=jquery(window);
    const globals={window,document:window.document,AbortController,URL,setInterval,clearInterval},icons=loadUnit('icons',{},globals);
    const fieldUi=loadUnit('field-ui',{_ujgTA_fields:h.fields,_ujgTA_icons:icons},globals);
    const settingsUi=loadUnit('settings-ui',{_ujgTA_profiles:loadUnit('profiles'),_ujgTA_fieldUi:fieldUi,_ujgTA_icons:icons},globals);
    const UI=loadUnit('ui',{_ujgTA_fieldUi:fieldUi,_ujgTA_icons:icons,_ujgTA_settingsUi:settingsUi,_ujgTA_validation:h.validation},globals);
    const Chat=loadUnit('chat',{_ujgTA_chatTools:loadUnit('chat-tools',{_ujgTA_fields:h.fields}),_ujgTA_draft:h.drafts},{AbortController});
    let chatUi,prompt=async()=>{throw Error('Pico HTTP 429');};
    const chat=Chat.create({controller:h.controller,store:h.store,runtime:{createSession(config){return {prompt:async text=>prompt(config,text),getMessages:()=>[],abort(){},dispose(){}};}},onChange:()=>{if(chatUi)chatUi.update(h.controller.getState());}});
    const ui=UI.create({$,controller:h.controller,panel:!legacy,getChatState:()=>chat.getState()});ui.mount(window.document.querySelector('#root'));
    const originalSummary=window.document.querySelector('[data-ta-field="summary"] input');
    if(!legacy){chatUi=loadUnit('chat-ui',{_ujgTA_icons:icons},globals).create({$,controller:h.controller,chat,editor:ui});chatUi.mount(window.document.querySelector('#root'));}
    const unsubscribe=h.controller.subscribe(s=>{ui.update(s);if(chatUi)chatUi.update(s);});
    t.after(()=>{unsubscribe();if(chatUi)chatUi.destroy();chat.destroy();ui.destroy();h.controller.destroy();window.close();});
    const doc=window.document;
    return {...h,window,doc,ui,chatUi,chat,originalSummary,setPrompt:fn=>{prompt=fn;}};
}
module.exports={liveFixture};
