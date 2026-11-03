define('_ujgKA_ui', [], function() {
    'use strict';
    function mount(root, options) {
        var doc=root.ownerDocument, chat=options.chat, connection=options.connection, store=options.storage, identity=options.identity;
        var dead=false, epoch=0, busy=false, lastQuestion='', lastNotice='', transcript=[], settings={}, returnFocus=null;
        root.classList.add('ujg-knowledge-assistant');
        function el(tag, text, attrs, parent) {
            var node=doc.createElement(tag); if(text!=null) node.textContent=text;
            Object.keys(attrs||{}).forEach(function(k){node.setAttribute(k,attrs[k]);});
            if(parent) parent.appendChild(node); return node;
        }
        function button(text, marker, parent) {return el('button',text,{type:'button',['data-ka-'+marker]:''},parent);}
        var header=el('header',null,{},root); el('strong','Pico · Знания',{},header);
        var scopeButton=button('Область поиска','scopes',header), settingsButton=button('Настройки','settings',header), full=button('На весь экран','fullscreen',header);
        var status=el('div','Проверьте подключение в настройках.',{'data-ka-status':'',role:'status','aria-live':'polite'},root);
        var storageWarning=el('p','Хранилище недоступно: диалог сохраняется только в памяти вкладки.',{'data-ka-storage-warning':'',role:'status'},root);storageWarning.hidden=true;
        var log=el('div',null,{'data-ka-messages':'',role:'log','aria-label':'Диалог поиска знаний'},root);
        var composer=el('form',null,{'data-ka-composer':''},root);
        var prompt=el('textarea',null,{'data-ka-prompt':'','aria-label':'Вопрос по корпоративным знаниям',placeholder:'Как оформить задачу DevOps?',rows:'2'},composer);
        var actions=el('div',null,{},composer), send=el('button','Отправить',{type:'submit','data-ka-send':''},actions), stop=button('Остановить','stop',actions), retry=button('Повторить','retry',actions);
        var panel=el('section',null,{'data-ka-panel':'',role:'dialog','aria-modal':'true','aria-label':'Настройки поиска знаний',tabindex:'-1'},root); panel.hidden=true;
        var panelHead=el('div',null,{},panel); el('h3','Подключение и поиск',{},panelHead); var close=button('Закрыть','close',panelHead);
        var panelStatus=el('p',null,{'data-ka-panel-status':'',role:'status'},panel);
        el('p','LLM: существующее общее подключение. Проверка читает Jira myself и Confluence user/current. PAT остаётся только в памяти вкладки. После перезагрузки нажмите «Загрузить мои настройки (Jira)», затем введите PAT.',{},panel);
        var fields={};
        function field(key,label,type) {
            var wrapper=el('label',label,{},panel), input=el(type==='textarea'?'textarea':'input',null,{['data-ka-'+key]:'','aria-label':label},wrapper);
            if(type!=='textarea') input.type=type||'text'; fields[key]=input; return input;
        }
        field('bridge','Bridge URL'); field('source-url','Confluence URL');
        field('token','Confluence PAT','password').autocomplete='off';
        function scopeField(key,label) {
            var wrap=el('div',null,{},panel); el('span',label,{},wrap);
            var chips=el('div',null,{['data-ka-'+key+'-chips']:''},wrap), input=el('input',null,{['data-ka-'+key]:'','aria-label':label,placeholder:'Ключи через запятую'},wrap);
            fields[key]=input;
            function update(){chips.replaceChildren(); keys(input.value).forEach(function(k){var b=button(k+' ×','remove-scope',chips); b.setAttribute('aria-label','Удалить '+k); b.onclick=function(){input.value=keys(input.value).filter(function(v){return v!==k;}).join(', '); update();};});}
            input.oninput=update; return update;
        }
        var spaceChips=scopeField('spaces','Пространства Confluence'), projectChips=scopeField('projects','Проекты Jira');
        field('skill','Корпоративные правила','textarea').rows=5;
        field('context','Контекст (оценка токенов)','number'); field('reserve','Резерв ответа','number');
        el('p','Системная политика фиксирована. Пустая область запрещает чтение соответствующего источника. Поиск: 20 результатов; фрагмент: 8000 символов; ход: 8 вызовов модели / 12 инструментов / 180 секунд.',{},panel);
        var restore=button('Загрузить мои настройки (Jira)','restore',panel);
        panel.insertBefore(restore,fields.bridge.parentNode);
        var apply=button('Применить и проверить','apply',panel);
        restore.onclick=async function(){
            if(!connection.restoreSettings)return;
            invalidate();identity=null;transcript=[];render();controls();var current=epoch;restore.disabled=true;
            try{var saved=await connection.restoreSettings();if(dead||current!==epoch)return;if(saved){openSettings(saved);tell('Настройки текущего пользователя Jira загружены. Введите PAT и нажмите «Применить и проверить»; история откроется после проверки Confluence.');}}
            catch(ignored){if(!dead&&current===epoch)tell('Не удалось загрузить настройки. Проверьте вход Jira и повторите.');}
            finally{if(!dead)restore.disabled=false;}
        };
        function keys(text){return String(text||'').split(/[,\s]+/).filter(function(k,i,a){return k && a.indexOf(k)===i;});}
        function tell(text){if(!dead){status.textContent=text;panelStatus.textContent=text;}}
        function persist(){if(store){store.save({settings:settings,history:transcript}); storageWarning.hidden=!(store.isPersistent && !store.isPersistent());}}
        function controls(){send.disabled=busy||!identity||!identity.key; stop.hidden=!busy; retry.hidden=busy||!lastQuestion; prompt.disabled=!identity||!identity.key;}
        function safeUrl(url){return typeof url==='string' && /^(https?:\/\/[^\s<>"']+|\/(?!\/)[^\s<>"']*)$/.test(url) && !/\\/.test(url);}
        function render(){
            log.replaceChildren();
            if(!transcript.length) el('p','Найдите правила, сравните версии и проверьте прочитанные источники. История не заменяет новое чтение.',{'data-ka-empty':''},log);
            transcript.forEach(function(m){
                var article=el('article',null,{'data-ka-role':m.role},log); el('small',m.role==='user'?'Вы':'Pico',{},article);
                // Plain text is deliberate: no model/source HTML, Markdown URL or remote image is executable.
                el('div',m.text,{'data-ka-text':''},article);
                (m.warnings||[]).forEach(function(w){el('p',w,{'data-ka-warning':''},article);});
                (m.sources||[]).forEach(function(s,i){
                    var card=el('details',null,{'data-ka-source':''},article);
                    el('summary','Источник '+(i+1)+' · '+(s.title||s.sourceId),{},card);
                    var historical=s.historical===true;
                    el('p',historical?'Исторический источник · требуется перечитать':s.complete?'Полнота: прочитано доступное представление':'Неполно: прочитана часть представления',{},card);
                    el('p',String(s.sourceId||'').indexOf('jira:')===0?'Описание задачи · без комментариев, вложений и истории':'Текст страницы Confluence · макросы и вложения могут быть недоступны',{},card);
                    el('p','Версия: '+(s.version==null?'неизвестна':s.version)+' · обновлено: '+(s.updatedAt||'неизвестно')+' · прочитано: '+(s.fetchedAt||'неизвестно')+' · диапазон '+(s.offset||0)+'–'+(s.end||0),{},card);
                    el('p',!historical && s.confirmed?'Диапазон подтверждён чтением; это не подтверждение истинности.':'Нет подтверждения свежего чтения без предупреждений.',{},card);
                    (s.warnings||[]).forEach(function(w){el('p',w,{},card);});
                    if(safeUrl(s.url)) el('a','Открыть источник',{href:s.url,target:'_blank',rel:'noopener noreferrer'},card);
                    var fragment=!historical && chat.getFragment ? chat.getFragment(s) : '';
                    el('pre',fragment||'Фрагмент недоступен в текущей памяти; перед ответом требуется новое чтение.',{'data-ka-fragment':''},card);
                });
            });
            log.scrollTop=log.scrollHeight;
        }
        function openSettings(draft){
            if(dead)return; returnFocus=doc.activeElement;
            var displayed=draft && Array.isArray(draft.spaces) ? draft : connection.getSettings ? connection.getSettings() : settings;
            fields.bridge.value=displayed.bridgeBaseUrl||''; fields['source-url'].value=displayed.confluenceBaseUrl||'';
            fields.token.value=''; fields.spaces.value=(displayed.spaces||[]).join(', '); fields.projects.value=(displayed.projects||[]).join(', ');
            fields.skill.value=displayed.skill && displayed.skill.instructions||'';
            fields.context.value=(displayed.tokenBudget||{}).context||32768; fields.reserve.value=(displayed.tokenBudget||{}).reserve||4096;
            spaceChips();projectChips();panel.hidden=false;fields.bridge.focus();
        }
        function closeSettings(){panel.hidden=true;fields.token.value='';if(returnFocus && returnFocus.focus)returnFocus.focus();}
        function invalidate(){epoch++;if(busy)chat.abort();busy=false;controls();}
        async function submit(text){
            if(dead||busy||!identity||!identity.key||!text.trim())return;
            text=options.redact ? options.redact(text) : text;
            var current=++epoch; busy=true; lastNotice=''; lastQuestion=text; prompt.value='';
            // A new turn invalidates the evidence behind all previous displayed source ranges.
            transcript.forEach(function(m){(m.sources||[]).forEach(function(s){s.historical=true;s.confirmed=false;});});
            transcript.push({role:'user',text:text,sources:[]}); render();persist();controls();tell('Поиск и чтение источников…');
            try {
                var result=await chat.prompt(text);
                if(dead||current!==epoch)return;
                if(result.answer) transcript.push({role:'assistant',text:result.answer,warnings:result.warnings||[],sources:result.sources||[]});
                tell(lastNotice || (result.status==='complete'?'Ответ готов. Полнота указана у каждого источника.':result.status==='aborted'?'Запрос остановлен.':result.status==='limit'?'Достигнут лимит хода. Уточните вопрос и повторите.':'Не удалось получить ответ. Откройте настройки подключения и повторите.'));
                render();persist();
            } catch(ignored){if(!dead&&current===epoch)tell('Не удалось получить ответ. Проверьте вход и PAT в настройках; повторите запрос.');}
            finally{if(!dead&&current===epoch){busy=false;controls();prompt.focus();}}
        }
        composer.onsubmit=function(e){e.preventDefault();submit(prompt.value);};
        stop.onclick=function(){invalidate();tell('Запрос остановлен.');prompt.focus();};
        retry.onclick=function(){submit(lastQuestion);};
        apply.onclick=async function(){
            var next={bridgeBaseUrl:fields.bridge.value.trim(),confluenceBaseUrl:fields['source-url'].value.trim(),spaces:keys(fields.spaces.value),projects:keys(fields.projects.value),
                skill:{id:'corporate-rules',name:'Корпоративные правила',instructions:fields.skill.value},tokenBudget:{context:Number(fields.context.value),reserve:Number(fields.reserve.value)}};
            if(!Number.isSafeInteger(next.tokenBudget.context)||!Number.isSafeInteger(next.tokenBudget.reserve)||next.tokenBudget.reserve<=0||next.tokenBudget.reserve>=next.tokenBudget.context){tell('Проверьте контекст и резерв ответа.');return;}
            invalidate(); identity=null;transcript=[];render();controls();var current=epoch;apply.disabled=true;var token=fields.token.value;fields.token.value='';
            try{var session=await connection.apply(next,token);if(dead||current!==epoch)return;if(session)setSession(session);settings=next;persist();closeSettings();tell('Jira и Confluence: пользователь проверен. Можно задать вопрос.');}
            catch(error){if(!dead&&current===epoch){panel.scrollTop=0;tell(error && error.code==='rate-limit'?'Превышен лимит запросов. Повторите проверку через '+(Number.isFinite(error.retryAfter)&&error.retryAfter>=0?error.retryAfter+' с':'некоторое время')+' в настройках.':error && /^(unauthorized|forbidden|not-configured)$/.test(error.code)?'Требуется авторизация: проверьте вход Jira и PAT Confluence в настройках и нажмите «Применить и проверить».':'Подключение не подтверждено. Проверьте URL, сеть и настройки; затем повторите проверку.');}}
            finally{token='';if(!dead)apply.disabled=false;}
        };
        settingsButton.onclick=scopeButton.onclick=openSettings;close.onclick=closeSettings;
        panel.onkeydown=function(e){if(e.key==='Escape'){e.preventDefault();closeSettings();}if(e.key==='Tab'){var nodes=Array.from(panel.querySelectorAll('button,input,textarea')).filter(function(n){return !n.disabled;});var first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&doc.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&doc.activeElement===last){e.preventDefault();first.focus();}}};
        full.onclick=function(){var on=root.classList.toggle('ka-fullscreen');full.textContent=on?'Свернуть':'На весь экран';full.setAttribute('aria-pressed',String(on));};
        function setSession(value){
            invalidate(); identity=value.identity; if(value.chat)chat=value.chat;if(value.storage)store=value.storage;
            settings=value.settings||settings; transcript=(value.history||[]).map(function(m){return Object.assign({},m,{sources:(m.sources||[]).map(function(s){return Object.assign({},s,{historical:true,confirmed:false});})});});lastQuestion='';
            scopeButton.textContent='Область: '+(settings.spaces||[]).concat(settings.projects||[]).join(', ');storageWarning.hidden=!(store && store.isPersistent && !store.isPersistent());render();controls();
        }
        var initial=store ? store.load() : {};
        setSession({identity:identity,settings:connection.getSettings ? connection.getSettings() : initial.settings,history:initial.history||[]});
        return {dispose:function(){if(dead)return;invalidate();dead=true;fields.token.value='';transcript=[];settings={};identity=null;store=null;root.replaceChildren();root.classList.remove('ka-fullscreen');},setSession:setSession,openSettings:openSettings,
            onEvent:function(event){if(dead||!busy)return;if(event.type==='tool')tell('Чтение источников · '+event.name);if(event.type==='compaction')tell(event.message);if(event.type==='error'||event.type==='limit'){lastNotice=event.message+' Проверьте настройки и повторите.';tell(lastNotice);}}};
    }
    return {mount:mount};
});
