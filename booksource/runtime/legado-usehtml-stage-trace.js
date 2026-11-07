/* Opt-in controlled-replay telemetry. Never log text, URLs, or credentials. */
var USEHTML_STAGE_TRACE = "1";
var _uhvTraceSequence = 0;
function _uhvTraceTime() { return new Date().getTime(); }
function _uhvTraceLog(j, stage, details) {
    try {
        var event = {stage: stage}, key;
        for (key in details) if (Object.prototype.hasOwnProperty.call(details, key)) event[key] = details[key];
        j.log("UHV-STAGE " + JSON.stringify(event));
    } catch (ignore) {}
}
function _uhvTraceDestinations(urls) {
    var counts = {codecogs: 0, translation: 0, other: 0}, i, url;
    for (i = 0; i < urls.length; i++) {
        url = String(urls[i]);
        if (/^https:\/\/latex\.codecogs\.com\//.test(url)) counts.codecogs++;
        else if (/^https:\/\/edge\.microsoft\.com\/translate\//.test(url)) counts.translation++;
        else counts.other++;
    }
    return counts;
}
function useHtmlTraceAjaxAll(j, urls, raw) {
    var operation = ++_uhvTraceSequence, started = _uhvTraceTime(), counts = _uhvTraceDestinations(urls), response;
    _uhvTraceLog(j, "ajaxAll:begin", {operation: operation, requests: urls.length,
        codecogs: counts.codecogs, translation: counts.translation, other: counts.other});
    try {
        response = j.ajaxAll(urls, raw);
        _uhvTraceLog(j, "ajaxAll:end", {operation: operation, elapsedMs: _uhvTraceTime() - started,
            responses: response && typeof response.length === "number" ? response.length : 0});
        return response;
    } catch (error) {
        _uhvTraceLog(j, "ajaxAll:error", {operation: operation, elapsedMs: _uhvTraceTime() - started});
        throw error;
    }
}
function useHtmlTraceAjax(j, url) {
    var operation = ++_uhvTraceSequence, started = _uhvTraceTime(), counts = _uhvTraceDestinations([url]), response;
    _uhvTraceLog(j, "ajax:begin", {operation: operation, requests: 1,
        codecogs: counts.codecogs, translation: counts.translation, other: counts.other});
    try {
        response = j.ajax(url);
        _uhvTraceLog(j, "ajax:end", {operation: operation, elapsedMs: _uhvTraceTime() - started});
        return response;
    } catch (error) {
        _uhvTraceLog(j, "ajax:error", {operation: operation, elapsedMs: _uhvTraceTime() - started});
        throw error;
    }
}
(function () {
    function wrap(name, original, metadata) {
        return function () {
            var operation = ++_uhvTraceSequence, started = _uhvTraceTime(), details, result;
            var j = arguments[name === "formulas" ? 2 : 1];
            try { details = metadata ? metadata(arguments) : {}; } catch (ignore) { details = {}; }
            details.operation = operation;
            _uhvTraceLog(j, name + ":begin", details);
            try {
                result = original.apply(this, arguments);
                details = {operation: operation, elapsedMs: _uhvTraceTime() - started};
                if (typeof result === "string") details.characters = result.length;
                if (name === "speech" && result) details.resolved = Object.keys(result).length;
                _uhvTraceLog(j, name + ":end", details);
                return result;
            } catch (error) {
                _uhvTraceLog(j, name + ":error", {operation: operation, elapsedMs: _uhvTraceTime() - started});
                throw error;
            }
        };
    }
    function htmlMetadata(args) { return {characters: args[0] == null ? 0 : String(args[0]).length}; }
    function valuesMetadata(args) { return {values: _ltArray(args[0]) ? args[0].length : 1}; }
    TH = wrap("TH", TH, htmlMetadata);
    TC = wrap("TC", TC, htmlMetadata);
    TT = wrap("TT", TT, valuesMetadata);
    _ltCodecogsWithSpeech = wrap("formulas", _ltCodecogsWithSpeech);
    _ltCodecogsSpeech = wrap("speech", _ltCodecogsSpeech, valuesMetadata);
})();
