define("_ujgDD_config", [], function() {
    "use strict";

    var SVG = ' xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

    var ICONS = {
        activity: "<svg" + SVG + '><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>',
        settings: "<svg" + SVG + '><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
        calendarRange: "<svg" + SVG + '><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M17 14h.01"/><path d="M12 14h.01"/><path d="M7 14h.01"/><path d="M17 18h.01"/><path d="M12 18h.01"/></svg>',
        download: "<svg" + SVG + '><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
        gitCommit: "<svg" + SVG + '><circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/></svg>',
        clock: "<svg" + SVG + '><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        arrowRight: "<svg" + SVG + '><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
        arrowLeft: "<svg" + SVG + '><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>',
        chevronDown: "<svg" + SVG + '><path d="m6 9 6 6 6-6"/></svg>',
        users: "<svg" + SVG + '><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        fileText: "<svg" + SVG + '><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><line x1="10" x2="18" y1="9" y2="9"/><line x1="10" x2="18" y1="13" y2="13"/><line x1="10" x2="18" y1="17" y2="17"/></svg>',
        bookOpen: "<svg" + SVG + '><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
        gitPullRequest: "<svg" + SVG + '><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/></svg>',
        alertTriangle: "<svg" + SVG + '><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
        checkCircle: "<svg" + SVG + '><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>',
        plus: "<svg" + SVG + '><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
        trash2: "<svg" + SVG + '><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
        x: "<svg" + SVG + '><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
        userPlus: "<svg" + SVG + '><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>',
        maximize2: "<svg" + SVG + '><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>',
        minimize2: "<svg" + SVG + '><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/></svg>'
    };

    var CONFLUENCE_ACTION_LABELS = {
        created: "создал",
        updated: "обновил",
        commented: "комментарий"
    };

    var WEEKDAYS_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
    var MONTHS_RU = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    var STORAGE_KEY = "ujg-dd-teams";

    function trimSlash(s) {
        return s.replace(/\/+$/, "");
    }

    function resolveJiraBaseUrl() {
        var origin = "";
        var protocol = "https:";
        if (typeof window !== "undefined") {
            origin = trimSlash(window.location.origin || "");
            protocol = window.location.protocol || protocol;
            if (window.AJS && window.AJS.params && window.AJS.params.baseURL != null) {
                var b = trimSlash(String(window.AJS.params.baseURL).trim());
                if (!b) return origin;
                if (/^[a-z]+:\/\//i.test(b)) return b;
                if (b.indexOf("//") === 0) return trimSlash(protocol + b);
                if (b.charAt(0) === "/") return trimSlash(origin + b);
                if (/^[^\/]+\.[^\/]+/.test(b) || /^[^\/]+:\d+(\/|$)/.test(b)) {
                    return trimSlash(protocol + "//" + b.replace(/^\/+/, ""));
                }
                return trimSlash(origin + "/" + b.replace(/^\/+/, ""));
            }
        }
        return origin;
    }

    function deriveSiblingOrigin(jiraBaseUrl, siblingSubdomain) {
        var u;
        try {
            u = new URL(jiraBaseUrl.indexOf("http") === 0 ? jiraBaseUrl : "https://" + jiraBaseUrl);
        } catch (e) {
            return "";
        }
        var host = u.hostname;
        var dot = host.indexOf(".");
        var h = dot > 0 ? siblingSubdomain + host.substring(dot) : siblingSubdomain + "." + host;
        return trimSlash(u.protocol + "//" + h);
    }

    var jiraBaseUrl = resolveJiraBaseUrl();
    var bitbucketBaseUrl = deriveSiblingOrigin(jiraBaseUrl || (typeof window !== "undefined" ? window.location.origin : "https://jira.local"), "bitbucket");
    var confluenceBaseUrl = deriveSiblingOrigin(jiraBaseUrl || (typeof window !== "undefined" ? window.location.origin : "https://jira.local"), "confluence");
    var debug = false;

    return {
        jiraBaseUrl: jiraBaseUrl,
        bitbucketBaseUrl: bitbucketBaseUrl,
        confluenceBaseUrl: confluenceBaseUrl,
        ICONS: ICONS,
        CONFLUENCE_ACTION_LABELS: CONFLUENCE_ACTION_LABELS,
        WEEKDAYS_RU: WEEKDAYS_RU,
        MONTHS_RU: MONTHS_RU,
        STORAGE_KEY: STORAGE_KEY,
        debug: debug
    };
});
