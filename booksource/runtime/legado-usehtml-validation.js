/* Experimental only: append after an HTML-producing content rule. */
function useHtmlValidation(html, pageUrl) {
    var input = html == null ? '' : String(html);
    if (!input.trim()) return '';
    var url = pageUrl == null ? '' : String(pageUrl).replace(/,\s*\{[\s\S]*$/, '');
    var doc = org.jsoup.Jsoup.parse(input, url);
    doc.outputSettings().prettyPrint(false);
    doc.select('script,noscript,style,iframe,object,embed,base,meta,link').remove();
    doc.setBaseUri(url);
    doc.select('usehtml').unwrap();

    var elements = doc.getAllElements();
    for (var i = 0; i < elements.size(); i++) {
        var attributes = elements.get(i).attributes().iterator();
        while (attributes.hasNext()) {
            var attribute = attributes.next();
            var key = String(attribute.getKey()).toLowerCase();
            if (/^on/.test(key) || key === 'srcdoc' || key === 'srcset' ||
                    (key === 'style' && /expression\s*\(|url\s*\(/i.test(String(attribute.getValue())))) {
                attributes.remove();
            }
        }
    }

    function resolve(element, attribute, image) {
        var value = String(element.attr(attribute)).trim();
        if (!value) return;
        var optionsAt = image ? value.search(/,\s*\{/) : -1;
        var options = optionsAt < 0 ? '' : value.substring(optionsAt);
        var resource = optionsAt < 0 ? value : value.substring(0, optionsAt);
        if (!image && /^(#|mailto:|tel:)/i.test(resource)) return;
        if (image && /^data:image\//i.test(resource)) return;
        if (/^[a-z][a-z0-9+.-]*:/i.test(resource) && !/^https?:/i.test(resource)) {
            element.removeAttr(attribute);
            return;
        }
        element.attr(attribute, resource);
        var absolute = String(element.absUrl(attribute));
        if (!/^https?:\/\//i.test(absolute)) {
            element.removeAttr(attribute);
            return;
        }
        element.attr(attribute, absolute + options);
    }

    var images = doc.select('img[src]');
    for (var j = 0; j < images.size(); j++) resolve(images.get(j), 'src', true);
    var links = doc.select('a[href]');
    for (var k = 0; k < links.size(); k++) resolve(links.get(k), 'href', false);

    var body = doc.body();
    if (!String(body.text()).trim() && doc.select('img[src],hr').isEmpty()) return '';
    if (body.children().isEmpty()) {
        var lines = String(body.wholeText()).split(/\r\n?|\n/);
        body.empty();
        for (var n = 0; n < lines.length; n++) {
            if (lines[n].trim()) body.appendElement('p').text(lines[n]);
        }
    }
    // ContentProcessor removes literal newlines inside protected HTML blocks.
    // Entities preserve text-node line breaks without creating new cache lines.
    return '<usehtml>' + String(body.html()).replace(/\r\n?|\n/g, '&#10;') + '</usehtml>';
}
