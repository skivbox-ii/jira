define('_ujgTA_main', ['jquery', '_ujgShared_llmClient', '_ujgTA_api', '_ujgTA_ai', '_ujgTA_storage', '_ujgTA_controller', '_ujgTA_ui', '_ujgTA_chat', '_ujgTA_chatUi', '_ujgTA_picoRuntime', '_ujgTA_fieldUi'],
function($, shared, apiModule, aiModule, storageModule, controllerModule, uiModule, chatModule, chatUiModule, picoRuntime, fieldUi) {
    'use strict';
    // Optional dependencies provide offline transport without changing product URL behavior.
    function TicketAssistantGadget(API, dependencies) {
        var deps = dependencies || {}, content = $(API.getGadgetContentEl());
        if (!content.length) throw new Error('Ticket assistant content element is missing');
        var root = content.hasClass('ujg-ticket-assistant') ? content : content.children('.ujg-ticket-assistant').first();
        if (!root.length) root = $('<div class="ujg-ticket-assistant">').appendTo(content);
        var previous = root.data('ta-instance'); if (previous) previous.destroy();
        var baseUrl = deps.baseUrl;
        if (baseUrl == null) baseUrl = typeof API.getBaseUrl === 'function' ? API.getBaseUrl() :
            typeof AJS !== 'undefined' && typeof AJS.contextPath === 'function' ? AJS.contextPath() : '';
        // Constructing the read adapter also validates the trusted context path for UI links.
        var readApi = apiModule.createApi({baseUrl:baseUrl, ajax:deps.ajax || function(config) {return $.ajax(config);}});
        var api = deps.api || readApi, ui, chat, chatUi, dead = false, warning = null;
        var resizeTimer = null, layoutObserver = null, mutationObserver = null;
        function scheduleResize() {
            if (dead || typeof API.resize !== 'function' || resizeTimer !== null) return;
            resizeTimer = window.setTimeout(function() {
                resizeTimer = null;
                if (!dead) API.resize();
            }, 16);
        }
        var storage;
        try {storage = deps.storage !== undefined ? deps.storage : window.localStorage;} catch (ignored) {storage = null;}
        var controller = controllerModule.create({api:api,
            ai:deps.ai || aiModule.createClient({llmClient:shared, fetchImpl:deps.fetchImpl || function(url, config) {return window.fetch(url, config);},
                readConfig:deps.readConfig || function() {return shared.readStoredConfig(storage);}}),
            createStore:deps.createStore || function(userKey) {
                var personalStore = storageModule.createStore({origin:window.location.origin, userKey:userKey, storage:storage,
                    onWarning:function() {
                        if (personalStore && personalStore.isPersistent()) return;
                        warning = 'Локальное хранилище недоступно; изменения сохраняются только в памяти. Перезагрузка может потерять изменения.';
                        showStorageWarning();
                    }});
                return personalStore;
            },
            onChange:function(state) {if (!dead && ui) {ui.update(state); if(chatUi)chatUi.update(state); scheduleResize();}}, now:deps.now});
        var searches = new Set();
        function searchUsers(query, field, options) {
            if (field && (field.kind === 'epic' || field.kind === 'sprint')) return controller.searchRelation(query,field,options);
            var aborter = new AbortController(), signal = options && options.signal;
            function abort() {aborter.abort();} if (signal) {if (signal.aborted) abort(); else signal.addEventListener('abort', abort, {once:true});}
            searches.add(aborter);
            return Promise.resolve().then(function() {return api.searchUsers(query, {signal:aborter.signal});}).finally(function() {
                searches.delete(aborter); if (signal) signal.removeEventListener('abort', abort);
            });
        }
        ui = uiModule.create({$: $, controller:controller, baseUrl:baseUrl, onSearch:searchUsers, createSettingsView:deps.createSettingsView, panel:!deps.legacyForm,
            getChatState:function(){return chat && chat.getState();},
            connection:{shared:shared,storage:storage}});
        ui.mount(root[0]);
        if(!deps.legacyForm) {
            chat=chatModule.create({controller:controller,runtime:deps.runtime || picoRuntime,requestText:deps.requestText || function(request) {
                var config;
                try {
                    config=shared.normalizeConfig((deps.readConfig || function(){return shared.readStoredConfig(storage);})());
                    if(!config)throw new Error('config');
                    var endpoint=new URL(config.apiBase);
                    if(!/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)throw new Error('config');
                } catch(ignored) {return Promise.reject(new Error('Pico connection configuration invalid'));}
                var settings=controller.getState().settings,budget=settings && settings.tokenBudget,httpStatus;
                return Promise.resolve().then(function(){return shared.requestText(config,{systemPrompt:request.system,userPrompt:request.user,preservePrompt:true,
                    tokenBudget:budget,signal:request.signal,allowProtocolFallback:false},function(url,fetchOptions) {
                    return Promise.resolve((deps.fetchImpl || window.fetch.bind(window))(url,Object.assign({},fetchOptions,{signal:request.signal}))).then(function(response){
                        if(response && response.status>=400 && response.status<=599)httpStatus=response.status;
                        return response;
                    });
                });}).catch(function(){throw new Error(httpStatus?'Pico HTTP '+httpStatus:'Pico transport failed');});
            },onChange:function(){if(!dead && chatUi){chatUi.update(controller.getState());ui.updateChatUsage();scheduleResize();}}});
            chatUi=chatUiModule.create({$: $,controller:controller,chat:chat,editor:ui,baseUrl:baseUrl,
                onSearch:searchUsers,getCurrentUser:function(options){return api.getCurrentUser(options);},
                createAssigneePicker:function(options){return fieldUi.create(options);}});
            chatUi.mount(root[0]);
        }
        var warningHost = $('<p class="ta-warning" data-ta-storage-warning hidden>');
        root.prepend(warningHost);
        if (typeof API.resize === 'function') {
            if (typeof window.ResizeObserver === 'function') {
                layoutObserver = new window.ResizeObserver(scheduleResize);
                layoutObserver.observe(root[0]);
            }
            // Popovers and fixed dialogs can change without resizing the root box.
            if (typeof window.MutationObserver === 'function') {
                mutationObserver = new window.MutationObserver(scheduleResize);
                mutationObserver.observe(root[0], {subtree:true, childList:true, attributes:true, characterData:true});
            }
        }
        scheduleResize();
        function showStorageWarning() {
            if (!dead && warningHost && warning) {warningHost.text(warning).prop('hidden',false); scheduleResize();}
        }
        var instance = this;
        this.controller = controller;
        this.chat = chat;
        this.openEditor = function() {if(!dead)ui.openEditor();};
        this.init = function() {return controller.init().then(function(state) {
            showStorageWarning(); return state;
        });};
        this.openSettings = function() {if (dead) return; var result = ui.openSettings(); scheduleResize(); return result;};
        this.destroy = function() {
            if (dead) return; dead = true;
            if (layoutObserver) layoutObserver.disconnect();
            if (mutationObserver) mutationObserver.disconnect();
            if (resizeTimer !== null) {window.clearTimeout(resizeTimer); resizeTimer = null;}
            if(chatUi)chatUi.destroy();if(chat)chat.destroy();
            controller.destroy(); searches.forEach(function(aborter) {aborter.abort();}); searches.clear(); ui.destroy();
            if (root.data('ta-instance') === instance) root.removeData('ta-instance');
        };
        root.data('ta-instance', this);
        this.ready = this.init();
    }
    return TicketAssistantGadget;
});
