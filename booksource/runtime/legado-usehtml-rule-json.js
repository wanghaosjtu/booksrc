/* Opt-in experiment: preserve literal request data through Legado rule parsing. */
function useHtmlRuleJson(value) {
    var json = JSON.stringify(value);
    if (json == null) return json;
    // Escape only JSON string tokens; structural object braces stay intact.
    return json.replace(/"(?:\\.|[^"\\])*"/g, function (literal) {
        return literal.replace(/[<>&@{}]/g, function (character) {
            return '\\u' + ('0000' + character.charCodeAt(0).toString(16)).slice(-4);
        });
    });
}

(function () {
    if (typeof _ltOptions !== 'function' || _ltOptions.useHtmlRuleJsonGuard) return;
    var original = _ltOptions;
    var guarded = function (body) {
        // Decode the existing serializer first to retain every existing option.
        return useHtmlRuleJson(JSON.parse(original(body)));
    };
    guarded.useHtmlRuleJsonGuard = true;
    _ltOptions = guarded;
})();
