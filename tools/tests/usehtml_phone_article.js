/* Fetch genuine documents using the existing source helper; no translation. */
var response = JSON.parse(String(java.ajax(String(toc_url('*', 1, 25)))));
var hits = response.results[0].hits;
var selected = null;
for (var i = 0; i < hits.length; i++) {
    var document = hits[i].document;
    var href = String(document.contentSummary.href || document.path);
    if (!/^https?:/i.test(href)) href = 'https://carnegieendowment.org' + href;
    if (/^https?:\/\/(?:[^/]+\.)?carnegieendowment\.org\/research\//i.test(href)) {
        selected = {title: String(document.contentSummary.title), url: href,
            publishedAt: document.contentSummary.publishedAt};
        break;
    }
}
if (selected == null) throw new Error('No genuine Carnegie research article in this page');
JSON.stringify({article: selected, fetchedDocuments: hits.length,
    method: 'original toc_url helper and original results[0].hits[*].document path'});
