/* Read-only check. Direct transport is set only on the experimental source. */
var proxy = String(source.getHeaderMap(false).get('proxy'));
var response = String(java.ajax('https://carnegieendowment.org/research'));
JSON.stringify({
    proxyBlank: proxy.trim().length === 0,
    hasResearchTitle: response.indexOf('Research | Carnegie') >= 0,
    length: response.length
});
