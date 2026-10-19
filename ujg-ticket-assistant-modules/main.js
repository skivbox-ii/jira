define('_ujgTA_main', ['jquery', '_ujgShared_llmClient', '_ujgTA_api', '_ujgTA_ai', '_ujgTA_storage', '_ujgTA_controller', '_ujgTA_ui'],
function($, shared, apiModule, aiModule, storageModule, controllerModule, uiModule) {
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
        var api = deps.api || readApi, ui, dead = false, warning = null;
        var storage;
        try {storage = deps.storage !== undefined ? deps.storage : window.localStorage;} catch (ignored) {storage = null;}
        var controller = controllerModule.create({api:api,
            ai:deps.ai || aiModule.createClient({llmClient:shared, fetchImpl:deps.fetchImpl || function(url, config) {return window.fetch(url, config);}, readConfig:deps.readConfig}),
            createStore:deps.createStore || function(userKey) {
                var personalStore = storageModule.createStore({origin:window.location.origin, userKey:userKey, storage:storage,
                    onWarning:function() {
                        if (personalStore && personalStore.isPersistent()) return;
                        warning = 'Локальное хранилище недоступно; изменения сохраняются только в памяти. Перезагрузка может потерять изменения.';
                        showStorageWarning();
                    }});
                return personalStore;
            },
            onChange:function(state) {if (!dead && ui) ui.update(state);}, now:deps.now});
        var searches = new Set();
        function searchUsers(query, field, options) {
            var aborter = new AbortController(), signal = options && options.signal;
            function abort() {aborter.abort();} if (signal) {if (signal.aborted) abort(); else signal.addEventListener('abort', abort, {once:true});}
            searches.add(aborter);
            return Promise.resolve().then(function() {return api.searchUsers(query, {signal:aborter.signal});}).finally(function() {
                searches.delete(aborter); if (signal) signal.removeEventListener('abort', abort);
            });
        }
        ui = uiModule.create({$: $, controller:controller, baseUrl:baseUrl, onSearch:searchUsers, createSettingsView:deps.createSettingsView});
        ui.mount(root[0]);
        var warningHost = $('<p class="ta-warning" data-ta-storage-warning hidden>');
        root.prepend(warningHost);
        function showStorageWarning() {
            if (!dead && warningHost && warning) warningHost.text(warning).prop('hidden',false);
        }
        var instance = this;
        this.controller = controller;
        this.init = function() {return controller.init().then(function(state) {
            showStorageWarning(); return state;
        });};
        this.openSettings = function() {return ui.openSettings();};
        this.destroy = function() {
            if (dead) return; dead = true; controller.destroy(); searches.forEach(function(aborter) {aborter.abort();}); searches.clear(); ui.destroy();
            if (root.data('ta-instance') === instance) root.removeData('ta-instance');
        };
        root.data('ta-instance', this);
        this.ready = this.init();
    }
    return TicketAssistantGadget;
});
