/* legado-common-loader v1: keep site declarations inline; share only common. */
var LEGADO_COMMON_URL = "https://raw.githubusercontent.com/wanghaosjtu/booksrc/__COMMON_COMMIT__/booksource/runtime/legado-shared-runtime.js";
var LEGADO_COMMON_VERSION = "1";
var __ltCommonApi = null;

function __ltBuildCommon(text) {
    // A direct eval creates a private closure which can still see this source's
    // inline configuration. It must not capture the first caller's java/cache.
    var TT, TJ, TC, TH, ltUseHtmlBlocks, LEGADO_SHARED_RUNTIME;
    eval(String(text));
    return {TT: TT, TJ: TJ, TC: TC, TH: TH,
        ltUseHtmlBlocks: ltUseHtmlBlocks, version: LEGADO_SHARED_RUNTIME};
}

function __ltLoadCommon(j) {
    if (__ltCommonApi !== null) return __ltCommonApi;
    try {
        if (!j || typeof j.importScript !== "function") throw new Error("No script importer");
        var text = j.importScript(LEGADO_COMMON_URL);
        if (text == null || !String(text).trim()) throw new Error("Empty common runtime");
        var api = __ltBuildCommon(String(text));
        if (String(api.version) !== LEGADO_COMMON_VERSION
            || typeof api.TT !== "function" || typeof api.TJ !== "function"
            || typeof api.TC !== "function" || typeof api.TH !== "function"
            || typeof api.ltUseHtmlBlocks !== "function") throw new Error("Incompatible common runtime");
        __ltCommonApi = api;
        try { j.log("Common runtime " + api.version + " loaded from pinned commit"); } catch (ignore) {}
        return api;
    } catch (error) {
        // Do not log downloaded code, source headers, or credentials. A failed
        // construction is never cached; a later call can retry the same URL.
        throw new Error("Cannot load common runtime: " + LEGADO_COMMON_URL
            + "; check network and pinned revision");
    }
}

function TT(v,j,c) { return __ltLoadCommon(j).TT(v,j,c); }
function TJ(v,j,c,k) { return __ltLoadCommon(j).TJ(v,j,c,k); }
function TC(v,j,c,o) { return __ltLoadCommon(j).TC(v,j,c,o); }
function TH(v,j,c,o) { return __ltLoadCommon(j).TH(v,j,c,o); }
function ltUseHtmlBlocks(v,j) { return __ltLoadCommon(j).ltUseHtmlBlocks(v); }
