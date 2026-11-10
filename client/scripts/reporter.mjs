var DEFAULT_SIZE = 10;
var DEFAULT_WAIT = 1000;
var stringifyBatch = function (list) {
    return JSON.stringify({
        ev_type: 'batch',
        list: list,
    });
};
function createBatchSender(config) {
    var transport = config.transport;
    var endpoint = config.endpoint, _a = config.size, size = _a === void 0 ? DEFAULT_SIZE : _a, _b = config.wait, wait = _b === void 0 ? DEFAULT_WAIT : _b;
    var batch = [];
    var tid = 0;
    var fail;
    var success;
    var sender = {
        getSize: function () {
            return size;
        },
        getWait: function () {
            return wait;
        },
        setSize: function (v) {
            size = v;
        },
        setWait: function (v) {
            wait = v;
        },
        getEndpoint: function () {
            return endpoint;
        },
        setEndpoint: function (v) {
            endpoint = v;
        },
        send: function (e) {
            batch.push(e);
            if (batch.length >= size) {
                sendBatch.call(this);
            }
            clearTimeout(tid);
            tid = setTimeout(sendBatch.bind(this), wait);
        },
        flush: function () {
            clearTimeout(tid);
            sendBatch.call(this);
        },
        getBatchData: function () {
            return batch.length ? stringifyBatch(batch) : '';
        },
        clear: function () {
            clearTimeout(tid);
            batch = [];
        },
        fail: function (cb) {
            fail = cb;
        },
        success: function (cb) {
            success = cb;
        },
    };
    function sendBatch() {
        if (!batch.length) {
            return;
        }
        var data = this.getBatchData();
        transport.post({
            url: endpoint,
            data: data,
            fail: function (err) {
                fail && fail(err, data);
            },
            success: function () {
                success && success(data);
            },
        });
        batch = [];
    }
    return sender;
}

/*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */

var __assign = function() {
    __assign = Object.assign || function __assign(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};

function __values(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
}

function __read(o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
}

function __spreadArray(to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
}

var noop = function () { return ({}); };
function id(v) {
    return v;
}

// eslint-disable-next-line @typescript-eslint/ban-types
function isObject(o) {
    return typeof o === 'object' && o !== null;
}
var objProto = Object.prototype;
function isArray(o) {
    return objProto.toString.call(o) === '[object Array]';
}
function isBoolean(o) {
    return typeof o === 'boolean';
}
function isNumber(o) {
    return typeof o === 'number';
}
function isString(o) {
    return typeof o === 'string';
}

// 检查数组中是否有元素
function arrayIncludes(array, value) {
    if (!isArray(array)) {
        return false;
    }
    if (array.length === 0) {
        return false;
    }
    var k = 0;
    while (k < array.length) {
        if (array[k] === value) {
            return true;
        }
        k++;
    }
    return false;
}
var arrayRemove = function (arr, e) {
    if (!isArray(arr)) {
        return arr;
    }
    var i = arr.indexOf(e);
    if (i >= 0) {
        var arr_ = arr.slice();
        arr_.splice(i, 1);
        return arr_;
    }
    return arr;
};
/**
 * 按路径访问对象属性
 * @param target 待访问对象
 * @param property 访问属性路径
 * @param { (target: any, property: string): any } visitor 访问器
 */
var safeVisit = function (target, path, visitor) {
    var _a, _b;
    var paths = path.split('.');
    var _c = __read(paths), method = _c[0], rest = _c.slice(1);
    while (target && rest.length > 0) {
        target = target[method];
        _a = rest, _b = __read(_a), method = _b[0], rest = _b.slice(1);
    }
    if (!target) {
        return undefined;
    }
    return visitor(target, method);
};

function safeStringify(a) {
    try {
        return isString(a) ? a : JSON.stringify(a);
    }
    catch (err) {
        return '[FAILED_TO_STRINGIFY]:' + String(err);
    }
}

function createContextAgent() {
    var context = {};
    var stringified = {};
    var contextAgent = {
        set: function (k, v) {
            context[k] = v;
            stringified[k] = safeStringify(v);
            return contextAgent;
        },
        merge: function (ctx) {
            context = __assign(__assign({}, context), ctx);
            Object.keys(ctx).forEach(function (key) {
                stringified[key] = safeStringify(ctx[key]);
            });
            return contextAgent;
        },
        delete: function (k) {
            delete context[k];
            delete stringified[k];
            return contextAgent;
        },
        clear: function () {
            context = {};
            stringified = {};
            return contextAgent;
        },
        get: function (k) {
            return stringified[k];
        },
        toString: function () {
            return __assign({}, stringified);
        },
    };
    return contextAgent;
}

var getPrintString = function () {
    // @ts-expect-error
    if (''.padStart) {
        return function (str, prefixLength) {
            if (prefixLength === void 0) { prefixLength = 8; }
            return str.padStart(prefixLength, ' ');
        };
    }
    return function (str) { return str; };
};
var printString = getPrintString();
var errCount = 0;
var error = function () {
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    // eslint-disable-next-line no-console
    console.error.apply(console, __spreadArray(['[SDK]', Date.now(), printString("" + errCount++)], __read(args), false));
};
var warnCount = 0;
var warn = function () {
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    // eslint-disable-next-line no-console
    console.warn.apply(console, __spreadArray(['[SDK]', Date.now(), printString("" + warnCount++)], __read(args), false));
};

var isHitBySampleRate = function (sampleRate) {
    if (Math.random() < Number(sampleRate)) {
        return true;
    }
    return false;
};
var isHitByRandom = function (random, sampleRate) {
    if (random < Number(sampleRate)) {
        return true;
    }
    return false;
};

var runProcessors = function (fns) {
    return function (e) {
        var r = e;
        for (var i = 0; i < fns.length; i++) {
            if (r) {
                try {
                    r = fns[i](r);
                }
                catch (err) {
                    error(err);
                }
            }
            else {
                break;
            }
        }
        return r;
    };
};

/**
 * 生成uuid
 * stolen from https://github.com/kelektiv/node-uuid#readme uuid/v4
 *
 * @returns
 */
function mathRNG() {
    var rnds = new Array(16);
    var r = 0;
    for (var i = 0; i < 16; i++) {
        if ((i & 0x03) === 0) {
            r = Math.random() * 0x100000000;
        }
        rnds[i] = (r >>> ((i & 0x03) << 3)) & 0xff;
    }
    return rnds;
}
function bytesToUuid(buf) {
    var byteToHex = [];
    for (var index = 0; index < 256; ++index) {
        byteToHex[index] = (index + 0x100).toString(16).substr(1);
    }
    var i = 0;
    var bth = byteToHex;
    // join used to fix memory issue caused by concatenation: https://bugs.chromium.org/p/v8/issues/detail?id=3175#c4
    return [
        bth[buf[i++]],
        bth[buf[i++]],
        bth[buf[i++]],
        bth[buf[i++]],
        '-',
        bth[buf[i++]],
        bth[buf[i++]],
        '-',
        bth[buf[i++]],
        bth[buf[i++]],
        '-',
        bth[buf[i++]],
        bth[buf[i++]],
        '-',
        bth[buf[i++]],
        bth[buf[i++]],
        bth[buf[i++]],
        bth[buf[i++]],
        bth[buf[i++]],
        bth[buf[i++]],
    ].join('');
}
function uuid() {
    var rnds = mathRNG();
    // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
    rnds[6] = (rnds[6] & 0x0f) | 0x40;
    rnds[8] = (rnds[8] & 0x3f) | 0x80;
    return bytesToUuid(rnds);
}

function createDestroyAgent() {
    var destroyed = false;
    var data = {};
    var removeTearDownGroup = function (tearDownGroup) {
        tearDownGroup.length &&
            tearDownGroup.forEach(function (v) {
                try {
                    v();
                    // eslint-disable-next-line no-empty
                }
                catch (_a) { }
            });
        tearDownGroup.length = 0;
    };
    var removeByPluginName = function (pluginName) {
        data[pluginName] &&
            data[pluginName].forEach(function (e) {
                removeTearDownGroup(e[1]);
            });
        data[pluginName] = undefined;
    };
    var removeByEvType = function (evType) {
        Object.keys(data).forEach(function (k) {
            data[k] &&
                data[k].forEach(function (e) {
                    if (e[0] === evType) {
                        removeTearDownGroup(e[1]);
                    }
                });
        });
    };
    return {
        /**
         * register tearDownGroup for a single plugin.
         */
        set: function (pluginName, evType, tearDownGroup) {
            if (data[pluginName])
                data[pluginName].push([evType, tearDownGroup]);
            else
                data[pluginName] = [[evType, tearDownGroup]];
            // auto remove tearDownGroup if destroyed
            destroyed && removeTearDownGroup(tearDownGroup);
        },
        has: function (pluginName) {
            return !!data[pluginName];
        },
        /**
         * remove tearDownGroup for a single plugin.
         */
        remove: removeByPluginName,
        /**
         * remove tearDownGroup by event type
         */
        removeByEvType: removeByEvType,
        /**
         * clear all tearDownGroup
         */
        clear: function () {
            destroyed = true;
            Object.keys(data).forEach(function (k) {
                removeByPluginName(k);
            });
        },
    };
}

// max size of preStartQueue
var PRESTART_QUEUE_MAX_SIZE = 500;
// slice size to operate preStartQueue
var PRESTART_QUEUE_OP_SLICE_SIZE = 50;
function cachePreStartData(client, preStartQueue, processed) {
    preStartQueue.push(processed);
    if (preStartQueue.length < PRESTART_QUEUE_MAX_SIZE) {
        return;
    }
    // delete some data to prevent OOM
    var deleteData = preStartQueue.splice(0, PRESTART_QUEUE_OP_SLICE_SIZE);
    if (client.savePreStartDataToDb) {
        void client.savePreStartDataToDb(deleteData);
    }
}
function consumePreStartData(client) {
    var preStartQueue = client.getPreStartQueue();
    preStartQueue.forEach(function (e) { return client.build(e); });
    preStartQueue.length = 0;
}

var EVENTS = [
    'init',
    'start',
    'config',
    'beforeDestroy',
    'provide',
    'beforeReport',
    'report',
    'beforeBuild',
    'build',
    'beforeSend',
    'send',
    'beforeConfig',
];

function createClient(creationConfig) {
    var builder = creationConfig.builder, createSender = creationConfig.createSender, createDefaultConfig = creationConfig.createDefaultConfig, createConfigManager = creationConfig.createConfigManager, userConfigNormalizer = creationConfig.userConfigNormalizer, initConfigNormalizer = creationConfig.initConfigNormalizer, validateInitConfig = creationConfig.validateInitConfig;
    var sender;
    var configManager;
    var handlers = {};
    EVENTS.forEach(function (e) { return (handlers[e] = []); });
    var inited = false;
    var started = false;
    var destroyed = false;
    // 缓存 start 之前 build 的事件
    var preStartQueue = [];
    // 禁止通过 provide 挂载的字段名
    var reservedNames = [];
    var destroyAgent = createDestroyAgent();
    var client = {
        getBuilder: function () { return builder; },
        getSender: function () { return sender; },
        getPreStartQueue: function () { return preStartQueue; },
        init: function (c) {
            if (inited) {
                warn('already inited');
                return;
            }
            if (c && isObject(c) && validateInitConfig(c)) {
                var defaultConfig = createDefaultConfig(c);
                if (!defaultConfig) {
                    throw new Error('defaultConfig missing');
                }
                var initConfig = initConfigNormalizer(c);
                configManager = createConfigManager(defaultConfig);
                configManager.setConfig(initConfig);
                configManager.onChange(function () {
                    handle('config');
                });
                sender = createSender(configManager.getConfig());
                if (!sender) {
                    throw new Error('sender missing');
                }
                inited = true;
                handle('init', true);
            }
            else {
                throw new Error('invalid InitConfig, init failed');
            }
        },
        set: function (c) {
            if (!inited) {
                return;
            }
            if (c && isObject(c)) {
                handle('beforeConfig', false, c);
                configManager === null || configManager === void 0 ? void 0 : configManager.setConfig(c);
            }
        },
        config: function (c) {
            if (!inited) {
                return;
            }
            if (c && isObject(c)) {
                handle('beforeConfig', false, c);
                configManager === null || configManager === void 0 ? void 0 : configManager.setConfig(userConfigNormalizer(c));
            }
            return configManager === null || configManager === void 0 ? void 0 : configManager.getConfig();
        },
        provide: function (name, value) {
            if (arrayIncludes(reservedNames, name)) {
                warn("cannot provide " + name + ", reserved");
                return;
            }
            client[name] = value;
            handle('provide', false, name);
        },
        start: function () {
            if (!inited) {
                return;
            }
            if (started) {
                return;
            }
            configManager === null || configManager === void 0 ? void 0 : configManager.onReady(function () {
                started = true;
                handle('start', true);
                consumePreStartData(client);
            });
        },
        report: function (data) {
            if (!data) {
                return;
            }
            var preReport = runProcessors(handlers['beforeReport'])(data);
            if (!preReport) {
                return;
            }
            var processed = runProcessors(handlers['report'])(preReport);
            if (!processed) {
                return;
            }
            if (started) {
                this.build(processed);
            }
            else {
                cachePreStartData(client, preStartQueue, processed);
            }
        },
        build: function (data) {
            if (!started) {
                return;
            }
            var preBuild = runProcessors(handlers['beforeBuild'])(data);
            if (!preBuild) {
                return;
            }
            var built = builder.build(preBuild);
            if (!built) {
                return;
            }
            var processed = runProcessors(handlers['build'])(built);
            if (!processed) {
                return;
            }
            this.send(processed);
        },
        send: function (data) {
            if (!started) {
                return;
            }
            var processed = runProcessors(handlers['beforeSend'])(data);
            if (processed) {
                sender.send(processed);
                handle('send', false, processed);
            }
        },
        destroy: function () {
            destroyAgent.clear();
            destroyed = true;
            preStartQueue.length = 0;
            handle('beforeDestroy', true);
        },
        on: function (ev, handler) {
            if ((ev === 'init' && inited) || (ev === 'start' && started) || (ev === 'beforeDestroy' && destroyed)) {
                try {
                    ;
                    handler();
                }
                catch (_err) {
                    // ignore
                }
            }
            else if (handlers[ev]) {
                handlers[ev].push(handler);
            }
        },
        off: function (ev, handler) {
            if (handlers[ev])
                handlers[ev] = arrayRemove(handlers[ev], handler);
        },
        destroyAgent: destroyAgent,
    };
    reservedNames = Object.keys(client);
    return client;
    function handle(ev, once) {
        if (once === void 0) { once = false; }
        var args = [];
        for (var _i = 2; _i < arguments.length; _i++) {
            args[_i - 2] = arguments[_i];
        }
        handlers[ev].forEach(function (f) {
            try {
                f.apply(void 0, __spreadArray([], __read(args), false));
            }
            catch (_err) {
                // ignore
            }
        });
        if (once) {
            handlers[ev].length = 0;
        }
    }
}

var ContextPlugin = function (client) {
    var contextAgent = createContextAgent();
    client.provide('context', contextAgent);
    client.on('report', function (ev) {
        if (!ev.extra) {
            ev.extra = {};
        }
        ev.extra.context = contextAgent.toString();
        return ev;
    });
};

function IntegrationPlugin(client, runAfterSetup) {
    client.on('init', function () {
        var nameList = [];
        var applyIntegrations = function (integrations) {
            integrations.forEach(function (integration) {
                var integrationName = integration.name;
                if (!arrayIncludes(nameList, integrationName)) {
                    nameList.push(integrationName);
                    integration.setup(client);
                    runAfterSetup && runAfterSetup(integrationName, integration.setup);
                    client.destroyAgent.set(integrationName, integrationName, [
                        function () {
                            nameList = arrayRemove(nameList, integrationName);
                            integration.tearDown && integration.tearDown();
                        },
                    ]);
                }
            });
        };
        client.provide('applyIntegrations', applyIntegrations);
        var config = client.config();
        if (config && config.integrations) {
            applyIntegrations(config.integrations);
        }
    });
}

var DevtoolsPlugin = function (client) {
    try {
        if (typeof window === 'object' && isObject(window) && window.__SLARDAR_DEVTOOLS_GLOBAL_HOOK__) {
            window.__SLARDAR_DEVTOOLS_GLOBAL_HOOK__.push(client);
        }
    }
    catch (e) {
        // ignore
    }
};

var now = function () { return Date.now(); };

function getDefaultBrowser() {
    if (typeof window === 'object' && isObject(window))
        return window;
}

// 获取全局注册表
var getGlobalRegistry = function (global) {
    if (!global)
        return;
    if (!global.__SLARDAR_REGISTRY__) {
        global.__SLARDAR_REGISTRY__ = {
            Slardar: {
                plugins: [],
                errors: [],
                subject: {},
            },
        };
    }
    return global.__SLARDAR_REGISTRY__.Slardar;
};
var reportSelfError = function () {
    var errorInfo = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        errorInfo[_i] = arguments[_i];
    }
    var registry = getGlobalRegistry(getDefaultBrowser());
    if (!registry)
        return;
    if (!registry.errors) {
        registry.errors = [];
    }
    registry.errors.push(errorInfo);
};

/**
 * Special support in Perfsee for analyzing call stacks of custom events and custom metrics.
 */
// eslint-disable-next-line
var getStacksOnPerfsee = function (constructor) {
    var _a;
    // @ts-expect-error
    if (typeof window !== 'object' || !window.__perfsee__) {
        return;
    }
    var obj = {};
    (_a = Error.captureStackTrace) === null || _a === void 0 ? void 0 : _a.call(Error, obj, constructor);
    return obj.stack;
};

var CUSTOM_EV_TYPE = 'custom';

var CUSTOM_EVENT_TYPE = 'event';
var CUSTOM_LOG_TYPE = 'log';
var normalizeCustomEventData = function (raw) {
    if (!raw || !isObject(raw)) {
        return;
    }
    // name is required
    if (!raw['name'] || !isString(raw['name'])) {
        return;
    }
    var res = {
        name: raw['name'],
        type: CUSTOM_EVENT_TYPE,
    };
    if ('metrics' in raw && isObject(raw['metrics'])) {
        var rMetrics = raw['metrics'];
        var metrics = {};
        for (var k in rMetrics) {
            if (isNumber(rMetrics[k])) {
                metrics[k] = rMetrics[k];
            }
        }
        res.metrics = metrics;
    }
    if ('categories' in raw && isObject(raw['categories'])) {
        var rCategories = raw['categories'];
        var categories = {};
        for (var k in rCategories) {
            categories[k] = safeStringify(rCategories[k]);
        }
        res.categories = categories;
    }
    if ('attached_log' in raw && isString(raw['attached_log'])) {
        res.attached_log = raw['attached_log'];
    }
    return res;
};
var normalizeCustomLogData = function (raw) {
    if (!raw || !isObject(raw)) {
        return;
    }
    // content is required
    if (!raw['content'] || !isString(raw['content'])) {
        return;
    }
    var rContent = raw['content'];
    var res = {
        content: safeStringify(rContent),
        type: CUSTOM_LOG_TYPE,
        level: 'info',
    };
    if ('level' in raw) {
        res.level = raw['level'];
    }
    if ('extra' in raw && isObject(raw['extra'])) {
        var rExtra = raw['extra'];
        var metrics = {};
        var categories = {};
        for (var k in rExtra) {
            if (isNumber(rExtra[k])) {
                metrics[k] = rExtra[k];
            }
            else {
                categories[k] = safeStringify(rExtra[k]);
            }
        }
        res.metrics = metrics;
        res.categories = categories;
    }
    if ('attached_log' in raw && isString(raw['attached_log'])) {
        res.attached_log = raw['attached_log'];
    }
    return res;
};
var CustomPlugin = function (client) {
    var sendEvent = function (data) {
        var normalized = normalizeCustomEventData(data);
        if (normalized) {
            var stacks = getStacksOnPerfsee(sendEvent);
            if (stacks) {
                // @ts-expect-error
                normalized.stacks = stacks;
            }
            client.report({
                ev_type: CUSTOM_EV_TYPE,
                payload: normalized,
                extra: {
                    timestamp: now(),
                },
            });
        }
    };
    var sendLog = function (data) {
        var normalized = normalizeCustomLogData(data);
        if (normalized) {
            client.report({
                ev_type: CUSTOM_EV_TYPE,
                payload: normalized,
                extra: {
                    timestamp: now(),
                },
            });
        }
    };
    client.provide('sendEvent', sendEvent);
    client.provide('sendLog', sendLog);
};

/* eslint-disable @typescript-eslint/prefer-for-of */
var withSampleRate = function (ev, sampleRate) {
    var common = ev.common || {};
    common.sample_rate = sampleRate;
    ev.common = common;
    return ev;
};
var hitFnWithRandom = function (preCalc, sampleRate, isHitBySampleRate, random, isHitByRandom) {
    return preCalc
        ? (function (h) { return function () {
            return h;
        }; })(isHitByRandom(random, sampleRate))
        : function () { return isHitBySampleRate(sampleRate); };
};
var parseValues = function (values, type) {
    return values.map(function (v) {
        switch (type) {
            case 'number':
                return Number(v);
            case 'boolean':
                return v === '1';
            case 'string': // default to string
            default:
                return String(v);
        }
    });
};
var checkVal = function (val, values, op) {
    switch (op) {
        case 'eq':
            return arrayIncludes(values, val);
        case 'neq':
            return !arrayIncludes(values, val);
        case 'gt':
            return val > values[0];
        case 'gte':
            return val >= values[0];
        case 'lt':
            return val < values[0];
        case 'lte':
            return val <= values[0];
        case 'regex':
            return Boolean(val.match(new RegExp(values.join('|'))));
        case 'not_regex':
            return !val.match(new RegExp(values.join('|')));
        default: {
            // unknown op
            return false;
        }
    }
};
var checkFilter = function (ev, field, op, values) {
    var val = safeVisit(ev, field, function (t, p) {
        return t[p];
    });
    if (val === undefined) {
        return false;
    }
    var field_type = isBoolean(val) ? 'bool' : isNumber(val) ? 'number' : 'string';
    return checkVal(val, parseValues(values, field_type), op);
};
var matchFilter = function (ev, filter) {
    try {
        return filter.type === 'rule'
            ? checkFilter(ev, filter.field, filter.op, filter.values)
            : filter.type === 'and'
                ? filter.children.every(function (f) { return matchFilter(ev, f); })
                : filter.children.some(function (f) { return matchFilter(ev, f); });
    }
    catch (e) {
        reportSelfError(e);
        return false;
    }
};
var getHitMap = function (rules, preCalcHit, baseRate, isHitBySampleRate, random, isHitByRandom) {
    var hitMap = {};
    Object.keys(rules).forEach(function (name) {
        var _a = rules[name], enable = _a.enable, sample_rate = _a.sample_rate, conditional_sample_rules = _a.conditional_sample_rules;
        if (enable) {
            hitMap[name] = {
                enable: enable,
                sample_rate: sample_rate,
                effectiveSampleRate: sample_rate * baseRate,
                hit: hitFnWithRandom(preCalcHit, sample_rate, isHitBySampleRate, random, isHitByRandom),
            };
            if (conditional_sample_rules) {
                hitMap[name].conditional_hit_rules = conditional_sample_rules.map(function (_a) {
                    var s = _a.sample_rate, filter = _a.filter;
                    return ({
                        sample_rate: s,
                        hit: hitFnWithRandom(preCalcHit, s, isHitBySampleRate, random, isHitByRandom),
                        effectiveSampleRate: s * baseRate,
                        filter: filter,
                    });
                });
            }
        }
        else {
            hitMap[name] = {
                enable: enable,
                hit: function () {
                    /* istanbul ignore next */
                    return false;
                },
                sample_rate: 0,
                effectiveSampleRate: 0,
            };
        }
    });
    return hitMap;
};
var getSampler = function (userId, config, isHitBySampleRate, isHitByRandom, destroyFns) {
    if (!config)
        return id;
    // r的设计是为了允许外部传入随机数，用于彻底实现按用户采样
    var baseRate = config.sample_rate, include_users = config.include_users, sample_granularity = config.sample_granularity, rules = config.rules, _a = config.r, random = _a === void 0 ? Math.random() : _a;
    // 用户名单采样
    var userHit = arrayIncludes(include_users, userId);
    if (userHit) {
        return function (ev) { return withSampleRate(ev, 1); };
    }
    // should pre calculate hit
    var preCalcHit = sample_granularity === 'session';
    var baseHit = hitFnWithRandom(preCalcHit, baseRate, isHitBySampleRate, random, isHitByRandom);
    var hitMap = getHitMap(rules, preCalcHit, baseRate, isHitBySampleRate, random, isHitByRandom);
    return function (ev) {
        var _a;
        // 总采样必须命中才有后续
        if (!baseHit()) {
            preCalcHit && destroyFns[0]();
            return false;
        }
        // 未配置的事件类型
        if (!(ev.ev_type in hitMap)) {
            return withSampleRate(ev, baseRate);
        }
        // 忽略未开启的事件类型
        if (!hitMap[ev.ev_type].enable) {
            preCalcHit && destroyFns[1](ev.ev_type);
            return false;
        }
        // 跳过采样配置
        if ((_a = ev.common) === null || _a === void 0 ? void 0 : _a.sample_rate) {
            return ev;
        }
        var hitConfig = hitMap[ev.ev_type];
        var conditions = hitConfig.conditional_hit_rules;
        if (conditions) {
            // 先判断条件采样
            for (var i = 0; i < conditions.length; i++) {
                if (matchFilter(ev, conditions[i].filter)) {
                    if (conditions[i].hit()) {
                        return withSampleRate(ev, conditions[i].effectiveSampleRate);
                    }
                    // 条件匹配后不再搜索
                    return false;
                }
            }
        }
        // 事件类型采样
        if (!hitConfig.hit()) {
            // not hit ev_type and no condition, destroy side effect
            !(conditions && conditions.length) && preCalcHit && destroyFns[1](ev.ev_type);
            return false;
        }
        // 事件类型默认采样已经命中
        return withSampleRate(ev, hitConfig.effectiveSampleRate);
    };
};
var SamplePlugin = function (client) {
    client.on('start', function () {
        var _a = client.config(), userId = _a.userId, sample = _a.sample;
        var destroyFns = [
            function () {
                client.destroy();
            },
            function (ev_type) {
                client.destroyAgent.removeByEvType(ev_type);
            },
        ];
        var sampler = getSampler(userId, sample, isHitBySampleRate, isHitByRandom, destroyFns);
        client.on('build', sampler);
    });
};

var builder = {
    build: function (e) {
        return {
            ev_type: e.ev_type,
            payload: e.payload,
            common: __assign(__assign({}, (e.extra || {})), (e.overrides || {})),
        };
    },
};

var REPORT_DOMAIN = "mon.zijieapi.com";
var SETTINGS_DOMAIN = REPORT_DOMAIN;
var SDK_VERSION = "2.1.8" ;
var SDK_NAME = 'SDK_BASE';
var SETTINGS_PATH = '/monitor_web/settings/browser-settings';
var BATCH_REPORT_PATH = "/monitor_browser/collect/batch/";
var DEFAULT_SAMPLE_CONFIG = {
    sample_rate: 1,
    include_users: [],
    sample_granularity: 'session',
    rules: {},
};
var DEFAULT_SENDER_SIZE = 20;
var DEFAULT_SAMPLE_GRANULARITY = 'session';

function normalizeStrictFields(config) {
    var e_1, _a;
    var strictFields = ['userId', 'deviceId', 'sessionId', 'env'];
    try {
        for (var strictFields_1 = __values(strictFields), strictFields_1_1 = strictFields_1.next(); !strictFields_1_1.done; strictFields_1_1 = strictFields_1.next()) {
            var k = strictFields_1_1.value;
            if (!config[k]) {
                delete config[k];
            }
        }
    }
    catch (e_1_1) { e_1 = { error: e_1_1 }; }
    finally {
        try {
            if (strictFields_1_1 && !strictFields_1_1.done && (_a = strictFields_1.return)) _a.call(strictFields_1);
        }
        finally { if (e_1) throw e_1.error; }
    }
    return config;
}
function normalizeInitConfig(config) {
    return normalizeStrictFields(__assign({}, config));
}
function validateInitConfig(config) {
    return isObject(config) && 'bid' in config && 'transport' in config;
}
function normalizeUserConfig(config) {
    return normalizeStrictFields(__assign({}, config));
}
function parseServerConfig(serverConfig) {
    if (!serverConfig) {
        return {};
    }
    var sample = serverConfig.sample, timestamp = serverConfig.timestamp, _a = serverConfig.quota_rate, quota_rate = _a === void 0 ? 1 : _a;
    if (!sample) {
        return {};
    }
    var sample_rate = sample.sample_rate, _b = sample.sample_granularity, sample_granularity = _b === void 0 ? DEFAULT_SAMPLE_GRANULARITY : _b, include_users = sample.include_users, _c = sample.rules, rules = _c === void 0 ? [] : _c;
    return {
        sample: {
            include_users: include_users,
            sample_rate: sample_rate * quota_rate,
            sample_granularity: sample_granularity,
            rules: rules.reduce(function (prev, cur) {
                var name = cur.name, enable = cur.enable, sample_rate = cur.sample_rate, conditional_sample_rules = cur.conditional_sample_rules;
                prev[name] = {
                    enable: enable,
                    sample_rate: sample_rate,
                    conditional_sample_rules: conditional_sample_rules,
                };
                return prev;
            }, {}),
        },
        serverTimestamp: timestamp,
    };
}

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
var getReportUrl = function (domain, path) {
    if (path === void 0) { path = BATCH_REPORT_PATH; }
    return "" + (domain && domain.indexOf('//') >= 0 ? '' : 'https://') + domain + path;
};
var getSettingsUrl = function (domain, path) {
    if (path === void 0) { path = SETTINGS_PATH; }
    return "" + (domain && domain.indexOf('//') >= 0 ? '' : 'https://') + domain + path;
};
var getDefaultUserId = function () {
    return uuid();
};
var getDefaultDeviceId = function () {
    return uuid();
};
var getViewId = function (pid) { return pid + "_" + Date.now(); };
var getDefaultSessionId = function () {
    return uuid();
};

var createConfigManager = function (defaultConfig) {
    // the merged config
    var config = defaultConfig;
    // save it so we know when initConfig is set
    var initConfig;
    // save UserConfig so we can merge with priority
    var userConfig = {};
    // save the original server config, from get_setting response
    var serverConfig;
    // cache the parsed ServerConfig, used in merge
    var parsedServerConfig;
    var onReady = noop;
    // call when config changed
    var onChange = noop;
    return {
        getConfig: function () {
            return config;
        },
        setConfig: function (c) {
            userConfig = __assign(__assign({}, userConfig), (c || {}));
            updateConfig();
            if (!initConfig) {
                // handle init
                initConfig = c;
                if (config.useLocalConfig || !config.bid) {
                    parsedServerConfig = {};
                    onReady();
                }
                else {
                    getServerConfig(config.transport, config.domain, config.bid, function (res) {
                        serverConfig = res;
                        handleServerConfig();
                    });
                }
            }
            return config;
        },
        onChange: function (fn) {
            onChange = fn;
        },
        onReady: function (fn) {
            onReady = fn;
            if (parsedServerConfig) {
                onReady();
            }
        },
    };
    function updateConfig() {
        var newConfig = __assign(__assign(__assign({}, defaultConfig), (parsedServerConfig || {})), userConfig);
        newConfig.sample = mergeSampleConfig(mergeSampleConfig(defaultConfig.sample, parsedServerConfig === null || parsedServerConfig === void 0 ? void 0 : parsedServerConfig.sample), userConfig.sample);
        config = newConfig;
        onChange();
    }
    function handleServerConfig() {
        parsedServerConfig = parseServerConfig(serverConfig);
        updateConfig();
        onReady();
    }
};
function getServerConfig(transport, domain, bid, cb) {
    if (!transport.get) {
        return cb({});
    }
    transport.get({
        withCredentials: true,
        url: getSettingsUrl(domain) + "?bid=" + bid + "&store=1",
        success: function (res) {
            cb(res.data || {});
        },
        fail: function () {
            cb({ sample: { sample_rate: 0.001 } });
        },
    });
}
function mergeSampleConfig(a, b) {
    if (!a || !b)
        return a || b;
    var res = __assign(__assign({}, a), b);
    res.include_users = __spreadArray(__spreadArray([], __read((a.include_users || [])), false), __read((b.include_users || [])), false);
    res.rules = __spreadArray(__spreadArray([], __read(Object.keys(a.rules || {})), false), __read(Object.keys(b.rules || {})), false).reduce(function (obj, key) {
        var _a, _b;
        if (!(key in obj)) {
            if (key in (a.rules || {}) && key in (b.rules || {})) {
                obj[key] = __assign(__assign({}, a.rules[key]), b.rules[key]);
                obj[key].conditional_sample_rules = __spreadArray(__spreadArray([], __read((a.rules[key].conditional_sample_rules || [])), false), __read((b.rules[key].conditional_sample_rules || [])), false);
            }
            else {
                obj[key] = ((_a = a.rules) === null || _a === void 0 ? void 0 : _a[key]) || ((_b = b.rules) === null || _b === void 0 ? void 0 : _b[key]);
            }
        }
        return obj;
    }, {});
    return res;
}

var addEnvToSendEvent = function (ev, config) {
    var _a = config || {}, version = _a.version, name = _a.name;
    var extra = {
        url: '',
        protocol: '',
        domain: '',
        path: '',
        query: '',
        timestamp: Date.now(),
        sdk_version: version || SDK_VERSION,
        sdk_name: name || SDK_NAME,
    };
    return __assign(__assign({}, ev), { extra: __assign(__assign({}, extra), (ev.extra || {})) });
};
var InjectEnvPlugin = function (client) {
    client.on('report', function (ev) {
        return addEnvToSendEvent(ev, client.config());
    });
};

var addConfigToReportEvent = function (ev, config) {
    var extra = {};
    extra.bid = config.bid;
    extra.pid = config.pid;
    extra.view_id = config.viewId;
    extra.user_id = config.userId;
    extra.device_id = config.deviceId;
    extra.session_id = config.sessionId;
    extra.release = config.release;
    extra.env = config.env;
    return __assign(__assign({}, ev), { extra: __assign(__assign({}, extra), (ev.extra || {})) });
};
var InjectConfigPlugin = function (client) {
    client.on('beforeBuild', function (ev) {
        return addConfigToReportEvent(ev, client.config());
    });
};

// createSender has side effects(register onClose behaviour)
// so it must be create lazily
function createSender(config) {
    return createBatchSender(config);
}

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
var getDefaultConfig = function (_c) { return ({
    bid: '',
    pid: '',
    viewId: getViewId('_'),
    userId: getDefaultUserId(),
    deviceId: getDefaultDeviceId(),
    sessionId: getDefaultSessionId(),
    domain: REPORT_DOMAIN,
    release: '',
    env: 'production',
    sample: DEFAULT_SAMPLE_CONFIG,
    plugins: {},
    transport: {
        get: noop,
        post: noop,
    },
    useLocalConfig: false,
}); };
var createMinimalClient = function (_a) {
    var _b = _a === void 0 ? {} : _a, _d = _b.createSender, createSender$1 = _d === void 0 ? function (config) {
        return createSender({
            size: DEFAULT_SENDER_SIZE,
            endpoint: getReportUrl(config.domain),
            transport: config.transport,
        });
    } : _d, _e = _b.builder, builder$1 = _e === void 0 ? builder : _e, _f = _b.createDefaultConfig, createDefaultConfig = _f === void 0 ? getDefaultConfig : _f;
    var client = createClient({
        validateInitConfig: validateInitConfig,
        initConfigNormalizer: normalizeInitConfig,
        userConfigNormalizer: normalizeUserConfig,
        createSender: createSender$1,
        builder: builder$1,
        createDefaultConfig: createDefaultConfig,
        createConfigManager: createConfigManager,
    });
    ContextPlugin(client);
    InjectConfigPlugin(client);
    InjectEnvPlugin(client);
    IntegrationPlugin(client);
    DevtoolsPlugin(client);
    return client;
};
var createBaseClient = function (config) {
    if (config === void 0) { config = {}; }
    var client = createMinimalClient(config);
    SamplePlugin(client);
    CustomPlugin(client);
    return client;
};

var browserClient = createBaseClient();

/**
 * compat module entry
 */

export { BATCH_REPORT_PATH, CustomPlugin, DEFAULT_SAMPLE_CONFIG, DEFAULT_SAMPLE_GRANULARITY, DEFAULT_SENDER_SIZE, InjectConfigPlugin, InjectEnvPlugin, REPORT_DOMAIN, SDK_NAME, SDK_VERSION, SETTINGS_DOMAIN, SETTINGS_PATH, addConfigToReportEvent, addEnvToSendEvent, builder, createBaseClient, createConfigManager, createMinimalClient, browserClient as default, getDefaultConfig, getDefaultDeviceId, getDefaultSessionId, getDefaultUserId, getReportUrl, getServerConfig, getSettingsUrl, getViewId, mergeSampleConfig, normalizeInitConfig, normalizeStrictFields, normalizeUserConfig, parseServerConfig, validateInitConfig };
