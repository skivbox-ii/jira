const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
function buildPreviewSource(){
    const amd=`(()=>{const modules=new Map();window.define=(name,deps,factory)=>modules.set(name,{deps,factory});window.define.amd=true;window.kaRequire=name=>{const m=modules.get(name);if(!m)throw Error('Missing '+name);if(!('value' in m))m.value=m.factory(...m.deps.map(kaRequire));return m.value;};})();\n`;
    const files=['ujg-shared-modules/llm-client.js','ujg-knowledge-assistant-modules/transport.js','ujg-knowledge-assistant-modules/evidence.js','ujg-knowledge-assistant-modules/jira-api.js','ujg-knowledge-assistant-modules/confluence-api.js','ujg-knowledge-assistant-modules/tools.js','ujg-knowledge-assistant-modules/skills.js','ujg-knowledge-assistant-modules/chat.js','ujg-knowledge-assistant-modules/storage.js','ujg-knowledge-assistant-modules/ui.js','ujg-knowledge-assistant-modules/main.js'];
    let pico=fs.readFileSync(path.join(root,'vendor/pico-1.4.0.amd.js'),'utf8');
    pico=pico.replace(/define\("[^"\n]+"/, 'define("_ujgKA_picoRuntime"');
    return amd+pico+'\n'+files.map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n')+'\n('+fixtures.toString()+')();';
}
function fixtures(){
    'use strict';
    document.body.style.cssText='margin:0;padding:16px;background:#edf1f6;color:#20334a;font:13px/1.5 system-ui';
    document.querySelector('main').style.cssText='max-width:920px;margin:auto';
    let scenario='normal',user='alice',turn=0,step=0,callSequence=0;
    const pageText='Для DevOps выберите шаблон: Задача, Ошибка или Задача развёртывания. Укажите сервис, окружение, цель, срок и критерии приёмки. Исключения согласуйте с владельцем сервиса.';
    const page={id:'42',type:'page',title:'Правила DevOps',space:{key:'DOC'},version:{number:3,when:'2026-11-03'},body:{storage:{value:'<p>'+pageText+'</p><ac:structured-macro ac:name="include"><ac:plain-text-body>hidden macro</ac:plain-text-body></ac:structured-macro>'}}};
    const issue={id:'1',key:'DO-1',fields:{summary:'Шаблоны DevOps',description:'Описание задачи: сервис, окружение, ожидаемый результат и владелец.',project:{key:'DO'},updated:'2026-11-02'}};
    const wait=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(done,ms);function abort(){clearTimeout(timer);reject(new DOMException('Stopped','AbortError'));}function done(){if(signal)signal.removeEventListener('abort',abort);resolve();}if(signal){if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});}});
    const response=(data,status=200)=>({ok:status===200,status,headers:{get:k=>k==='Retry-After'?'5':'application/json'},json:async()=>data});
    async function fetchImpl(raw,options){
        await wait(90,options.signal);const url=new URL(raw,location.origin),p=url.pathname;
        if(scenario==='network')throw Error('Fixture network failure');
        if(scenario==='denied')return response({},401);if(scenario==='forbidden')return response({},403);if(scenario==='rate')return response({},429);
        if(p.endsWith('/myself'))return response({key:user,name:user});
        if(p.endsWith('/user/current'))return response({type:'known',userKey:user,username:user});
        if(p.endsWith('/content/search'))return response({results:[page],totalSize:1,start:Number(url.searchParams.get('start')||0)});
        if(p.endsWith('/content/42'))return response(page);
        if(p.endsWith('/search'))return response({issues:[issue],total:1,startAt:Number(url.searchParams.get('startAt')||0)});
        if(p.endsWith('/issue/DO-1'))return response(issue);
        throw Error('Unexpected fixture route');
    }
    async function requestText(request){
        await wait(scenario==='slow'?15000:180,request.signal);
        // Pico sends a JSON envelope; reset the deterministic fixture at each user prompt.
        const payload=JSON.parse(request.user);const users=(payload.messages||[]).filter(m=>m.role==='user').length;
        if(users!==turn){turn=users;step=0;}
        step++;
        const call=(id,name,args)=>({id:id+'-'+(++callSequence),name,arguments:args});let result;
        if(['denied','forbidden','network','rate'].includes(scenario))result={text:'Синтетический отказ источника. Проверьте вход Jira, PAT Confluence и настройки; затем повторите запрос.',toolCalls:[]};
        else if(step===1)result={text:'',toolCalls:[call('search-c','search_confluence',{text:'DevOps'}),call('search-j','search_jira',{text:'DevOps'})]};
        else if(step===2)result={text:'',toolCalls:[call('read-c','read_page',{id:'42'}),call('read-j','read_issue',{id:'DO-1'})]};
        else {step=0;result={text:'В синтетическом примере DevOps доступны три шаблона: Задача, Ошибка и Задача развёртывания.\n\nОбязательные сведения: сервис, окружение, цель, срок и критерии приёмки. Исключения согласуются с владельцем сервиса. [[confluence:42@0:80]]\n\nВ описании задачи также указан владелец. [[jira:DO-1@0:40]]\n\n'+(scenario==='conflict'?'Документы расходятся по срокам: не выбирайте версию без уточнения владельца. ':'')+'Макрос страницы недоступен; полнота правил не подтверждена.'+(scenario==='long'?'\n\n'+('Дополнительный пункт: проверьте окружение и согласование.\n'.repeat(45)):''),toolCalls:[]};}
        return {text:JSON.stringify(result)};
    }
    const Gadget=kaRequire('_ujgKnowledgeAssistant');
    window.knowledgePreview={gadget:new Gadget({getGadgetContentEl:()=>document.querySelector('#knowledge-preview'),getBaseUrl:()=>'',resize(){}},{fetchImpl,requestText,settings:{bridgeBaseUrl:'http://localhost:8765',confluenceBaseUrl:'https://wiki.fixture.invalid',spaces:['DOC'],projects:['DO']}}),setScenario:value=>{scenario=value;step=0;}};
    ['normal','long','denied','forbidden','network','rate','conflict','slow'].forEach(name=>document.querySelector('#fixture-'+name).onclick=()=>{scenario=name;step=0;});
    document.querySelector('#fixture-user').onclick=()=>{user=user==='alice'?'bob':'alice';scenario='normal';step=0;window.knowledgePreview.gadget.openSettings();};
    window.knowledgePreview.gadget.openSettings();document.querySelector('[data-ka-token]').value='offline-fixture-PAT';
}
async function startPreview({port=4324}={}){
    const server=http.createServer((req,res)=>{
        res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
        if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
        const p=new URL(req.url,'http://localhost').pathname;let body,type;
        if(p==='/'){body=fs.readFileSync(path.join(root,'standalone/knowledge-assistant-preview.html'));type='text/html; charset=utf-8';}
        else if(p==='/preview.js'){body=buildPreviewSource();type='text/javascript; charset=utf-8';}
        else if(p==='/ujg-knowledge-assistant.css'){body=fs.readFileSync(path.join(root,'ujg-knowledge-assistant.css'));type='text/css; charset=utf-8';}
        else if(p==='/favicon.ico'){res.writeHead(204);res.end();return;}
        else{res.writeHead(404);res.end();return;}
        res.setHeader('Content-Type',type);res.end(req.method==='HEAD'?'':body);
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    return {url:'http://127.0.0.1:'+server.address().port+'/',close:()=>new Promise(resolve=>server.close(resolve))};
}
if(require.main===module)startPreview({port:Number(process.env.KA_PREVIEW_PORT||4324)}).then(p=>console.log('Knowledge offline preview: '+p.url));
module.exports={startPreview,buildPreviewSource};
