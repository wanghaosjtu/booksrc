/* legado-translation-runtime v1
 * Inline this file in a source's jsLib.  It deliberately uses ES5 syntax:
 * the target is Rhino on Android, not a desktop JavaScript engine.
 */
var LEGADO_TRANSLATION_RUNTIME = "1";

function _ltString(value) {
    return value == null ? "" : String(value);
}

function _ltCacheGet(cache, key) {
    try { return cache && cache.get(key); } catch (e) { return null; }
}

function _ltCachePut(cache, key, value, seconds) {
    try { if (cache) cache.put(key, value, seconds); } catch (e) {}
}

function _ltTarget(java) {
    var target = "";
    try { target = java.get("TARGET_LANG"); } catch (e) {}
    return target && String(target).trim() ? String(target) : "zh-Hans";
}

function _ltAuth(java, cache) {
    var key = "legado_ms_translate_auth";
    var token = _ltCacheGet(cache, key);
    if (token && String(token).length > 20) return String(token);
    try { token = java.ajax("https://edge.microsoft.com/translate/auth"); } catch (e) { return ""; }
    token = _ltString(token);
    if (token) _ltCachePut(cache, key, token, 600);
    return token;
}

function _ltBody(response) {
    try {
        if (!response) return "";
        // Legado StrResponse exposes both a public body property and body().
        // Rhino may resolve the property first, so support both shapes.
        var body = response.body;
        if (body != null && typeof body !== "function") return _ltString(body);
        if (typeof body === "function") return _ltString(body.call(response));
    } catch (e) {}
    return _ltString(response);
}

/* Java/Rhino compatibility helpers. */
function _ltJavaString(value) {
    try {
        return value != null && value.getClass && String(value.getClass().getName()).indexOf("String") >= 0;
    } catch (e) { return false; }
}

function _ltArray(value) {
    return Object.prototype.toString.call(value) === "[object Array]";
}

function _ltMarker(index) {
    return "<|L" + index + "|>";
}

/* Edge sometimes normalizes entity-escaped or spaced marker text. */
function _ltNormalizeMarkers(value) {
    return _ltString(value)
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/<\s*\|\s*L\s*(\d+)\s*\|\s*>/gi, function (_, index) {
            return _ltMarker(index);
        });
}

/* Recover only segments whose two boundaries are known. A missing marker
 * never causes neighboring source texts to be merged into one DOM node. */
function _ltSplitLabeled(value, originals) {
    var text = _ltNormalizeMarkers(value), matches = [], re = /<\|L(\d+)\|>/g, match;
    while ((match = re.exec(text)) !== null) {
        matches.push({id: parseInt(match[1], 10), start: match.index, end: re.lastIndex});
    }
    if (!matches.length) return null;
    var pieces = {}, reliable = {};
    for (var i = 0; i < matches.length; i++) {
        var current = matches[i], next = i + 1 < matches.length ? matches[i + 1] : null;
        if (current.id < 1 || current.id > originals.length || pieces[current.id] !== undefined) continue;
        var nextId = next ? next.id : 0;
        // A segment is safe when its next marker is the immediately following
        // label, or when it is the final expected segment.
        reliable[current.id] = (next && nextId === current.id + 1) || (!next && current.id === originals.length);
        pieces[current.id] = text.substring(current.end, next ? next.start : text.length)
            .replace(/^\s+|\s+$/g, "");
    }
    return {pieces: pieces, reliable: reliable};
}

function _ltRequestOptions(token, body) {
    return JSON.stringify({
        "headers": {"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        "method": "post",
        "body": JSON.stringify(body)
    });
}

function _ltRequest(java, token, target, values) {
    try {
        return java.ajax("https://edge.microsoft.com/translate/translatetext?to=" +
            encodeURIComponent(target) + "," + _ltRequestOptions(token, values));
    } catch (e) { return ""; }
}

function _ltTranslationTexts(response) {
    var parsed = null, body = _ltBody(response);
    try { parsed = JSON.parse(body); } catch (e) {}
    if (!_ltArray(parsed)) return null;
    var values = [];
    for (var i = 0; i < parsed.length; i++) {
        try { values[i] = _ltString(parsed[i].translations[0].text); }
        catch (e) { return null; }
    }
    return values;
}

/* Safe compatibility fallback for providers that remove all labels. */
function _ltFallbackValues(java, token, target, values) {
    var output = [], urls = [], i;
    for (i = 0; i < values.length; i++) {
        output[i] = values[i];
        urls.push("https://edge.microsoft.com/translate/translatetext?to=" +
            encodeURIComponent(target) + "," + _ltRequestOptions(token, [values[i]]));
    }
    for (var start = 0; start < urls.length; start += 4) {
        var end = Math.min(start + 4, urls.length), responses = [];
        try { responses = java.ajaxAll(urls.slice(start, end), false) || []; }
        catch (e) {
            for (i = start; i < end; i++) responses.push(_ltRequest(java, token, target, [values[i]]));
        }
        for (var r = 0; r < responses.length; r++) {
            var texts = _ltTranslationTexts(responses[r]);
            if (texts && texts.length === 1) output[start + r] = texts[0];
        }
    }
    return output;
}

/* Translate one scalar or an array. Arrays are joined into labeled documents
 * so Edge sees neighboring prose as context; results are mapped back safely. */
function TT(text, java, cache) {
    var scalar = text == null || typeof text === "string" || text instanceof String || _ltJavaString(text) || !_ltArray(text);
    var input = scalar ? [_ltString(text)] : (text || []);
    var output = [], pending = [], indexes = [], chunks = [], chunkIndexes = [];
    var chars = 0, i;
    for (i = 0; i < input.length; i++) {
        var value = _ltString(input[i]);
        output[i] = value;
        if (!value.trim()) continue;
        var cacheKey = "legado_ms:" + _ltTarget(java) + ":" + value;
        var cached = _ltCacheGet(cache, cacheKey);
        if (cached != null) { output[i] = _ltString(cached); continue; }
        var markerCost = 16;
        if (pending.length && (chars + value.length + markerCost > 3600 || pending.length >= 200)) {
            chunks.push(pending); chunkIndexes.push(indexes);
            pending = []; indexes = []; chars = 0;
        }
        pending.push(value); indexes.push(i); chars += value.length + markerCost;
    }
    if (pending.length) { chunks.push(pending); chunkIndexes.push(indexes); }
    if (!chunks.length) return scalar ? output[0] : output;

    var token = _ltAuth(java, cache), target = _ltTarget(java), urls = [];
    for (i = 0; i < chunks.length; i++) {
        var parts = [];
        for (var n = 0; n < chunks[i].length; n++)
            parts.push(_ltMarker(n + 1) + "\n" + chunks[i][n]);
        var joined = parts.join("\n");
        urls.push("https://edge.microsoft.com/translate/translatetext?to=" +
            encodeURIComponent(target) + "," + _ltRequestOptions(token, [joined]));
    }

    for (var wave = 0; wave < urls.length; wave += 4) {
        var waveEnd = Math.min(wave + 4, urls.length), responses = [], handled = {};
        try { responses = java.ajaxAll(urls.slice(wave, waveEnd), false) || []; }
        catch (e) {
            for (i = wave; i < waveEnd; i++) responses.push(_ltRequest(java, token, target, [
                (function (values) {
                    var joined = [], q;
                    for (q = 0; q < values.length; q++) joined.push(_ltMarker(q + 1) + "\n" + values[q]);
                    return joined.join("\n");
                })(chunks[i])
            ]));
        }
        for (var r = 0; r < responses.length && wave + r < waveEnd; r++) {
            var ci = wave + r, translated = _ltTranslationTexts(responses[r]);
            handled[ci] = true;
            var unresolved = [], resolved = {};
            if (translated && translated.length === 1) {
                var split = _ltSplitLabeled(translated[0], chunks[ci]);
                if (split) {
                    for (n = 0; n < chunks[ci].length; n++) {
                        if (split.reliable[n + 1] && split.pieces[n + 1] !== undefined) {
                            var oi = chunkIndexes[ci][n];
                            output[oi] = split.pieces[n + 1];
                            _ltCachePut(cache, "legado_ms:" + target + ":" + chunks[ci][n], output[oi], 2592000);
                            resolved[n] = true;
                        }
                    }
                }
            }
            for (n = 0; n < chunks[ci].length; n++) if (!resolved[n]) unresolved.push(chunks[ci][n]);
            if (unresolved.length) {
                var fallback = _ltFallbackValues(java, token, target, unresolved), fi = 0;
                for (n = 0; n < chunks[ci].length; n++) if (!resolved[n]) {
                    output[chunkIndexes[ci][n]] = fallback[fi];
                    if (fallback[fi] !== chunks[ci][n]) _ltCachePut(cache, "legado_ms:" + target + ":" + chunks[ci][n], fallback[fi], 2592000);
                    fi++;
                }
            }
        }
        // ajaxAll may return fewer responses than requested; preserve ordering
        // and use the same safe per-item fallback for missing waves.
        for (ci = wave; ci < waveEnd; ci++) if (!handled[ci]) {
            var missing = _ltFallbackValues(java, token, target, chunks[ci]);
            for (n = 0; n < chunks[ci].length; n++) {
                output[chunkIndexes[ci][n]] = missing[n];
                if (missing[n] !== chunks[ci][n]) _ltCachePut(cache, "legado_ms:" + target + ":" + chunks[ci][n], missing[n], 2592000);
            }
        }
    }
    return scalar ? output[0] : output;
}

var _LT_SKIP_KEYS = {href:1, src:1, url:1, path:1, id:1, uuid:1, isbn:1, doi:1,
    cover:1, coverUrl:1, bookUrl:1, chapterUrl:1, htmlLink:1, link:1};

function _ltSkipJsonKey(key) {
    var name = _ltString(key).toLowerCase();
    // JSON APIs also carry semantic enum fields (IEEE accessType.type is
    // "locked"/"unlocked"). Translating those values breaks downstream
    // rules such as isVip, which intentionally compare the original token.
    if (name === "type" || name === "status") return true;
    return !!_LT_SKIP_KEYS[key] || /(?:url|href|path|link|id|uuid|isbn|doi)$/.test(name);
}

/* Optional keys selects string fields by exact name, at any nesting level.
 * Omitted/null retains legacy traversal; [] translates nothing. Protected
 * URL/identifier/status fields are never translated, even if allowlisted. */
function TJ(json, java, cache, keys) {
    var parsed = json;
    var stringInput = typeof json === "string" || json instanceof String || _ltJavaString(json);
    try { if (stringInput) parsed = JSON.parse(_ltString(json)); } catch (e) { return json; }
    var paths = [], texts = [], allowed = null;
    if (keys != null) {
        if (!_ltArray(keys)) return json;
        allowed = {};
        for (var ki = 0; ki < keys.length; ki++) allowed["$" + _ltString(keys[ki])] = true;
        if (!keys.length) return json;
    }
    function collect(value, parent, key) {
        if (typeof value === "string" || value instanceof String || _ltJavaString(value)) {
            if (!_ltSkipJsonKey(key) && (allowed == null || allowed["$" + key] === true)) {
                paths.push({parent: parent, key: key});
                texts.push(_ltString(value));
            }
            return;
        }
        if (Object.prototype.toString.call(value) === "[object Array]") {
            for (var i = 0; i < value.length; i++) collect(value[i], value, i);
            return;
        }
        if (value && typeof value === "object") {
            for (var name in value) if (Object.prototype.hasOwnProperty.call(value, name)) collect(value[name], value, name);
        }
    }
    collect(parsed, null, "");
    if (texts.length) {
        var translated = TT(texts, java, cache);
        for (var i = 0; i < paths.length; i++) {
            if (paths[i].parent == null) parsed = translated[i];
            else paths[i].parent[paths[i].key] = translated[i];
        }
    }
    return stringInput ? JSON.stringify(parsed) : parsed;
}
function _ltExcluded(node, selectors) {
    var parent = node && node.parent ? node.parent() : null;
    while (parent) {
        try { if (parent.hasClass("notranslate")) return true; } catch (e) {}
        for (var i = 0; selectors && i < selectors.length; i++) {
            try { if (parent.is(String(selectors[i]))) return true; } catch (e) {}
        }
        parent = parent.parent ? parent.parent() : null;
    }
    return false;
}

/* Translate text nodes only; HTML tags and attributes survive intact. */
function TC(html, java, cache, options) {
    options = options || {};
    if (html == null || !_ltString(html).trim()) return html;
    var doc = org.jsoup.Jsoup.parseBodyFragment(_ltString(html));
    var nodes = [], values = [], elements = doc.select("*");
    for (var i = 0; i < elements.size(); i++) {
        var element = elements.get(i), textNodes = element.textNodes();
        for (var j = 0; j < textNodes.size(); j++) {
            var node = textNodes.get(j), value = _ltString(node.getWholeText());
            if (value.trim() && !_ltExcluded(node, options.notranslate_selector || [])) {
                nodes.push(node); values.push(value);
            }
        }
    }
    var translated = TT(values, java, cache);
    for (i = 0; i < nodes.length; i++) nodes[i].text(_ltString(translated[i]));
    return _ltString(doc.body().html());
}

function _ltRemove(doc, selectors) {
    if (!selectors) return;
    for (var i = 0; i < selectors.length; i++) {
        try { doc.select(String(selectors[i])).remove(); } catch (e) {}
    }
}

function _ltExtract(doc, selectors) {
    if (!selectors) return;
    for (var i = 0; i < selectors.length; i++) {
        var selected;
        try { selected = doc.select(String(selectors[i])); } catch (e) { continue; }
        for (var j = 0; j < selected.size(); j++) {
            var element = selected.get(j), text = _ltString(element.text());
            element.replaceWith(new org.jsoup.nodes.TextNode(text));
        }
    }
}

function _ltSrcsetValue(value) {
    var parts = _ltString(value).split(",");
    for (var i = parts.length - 1; i >= 0; i--) {
        var candidate = parts[i].trim().split(/\s+/)[0];
        if (candidate) return candidate;
    }
    return "";
}

function _ltImageUsable(value) {
    var src = _ltString(value).trim().toLowerCase();
    if (!src || src === "#") return false;
    if (src.indexOf("javascript:") === 0 || src.indexOf("about:") === 0) return false;
    return src.indexOf("transparent") < 0 && src.indexOf("placeholder") < 0 && src.indexOf("spacer") < 0;
}

function _ltImageAttrCandidate(element, name) {
    var value = _ltString(element.attr(name)).trim();
    if (!value) return "";
    return name.indexOf("srcset") >= 0 ? _ltSrcsetValue(value) : value;
}

/* Keep real lazy-loaded images working after DOM cleanup. */
function _ltReplaceAltImages(doc, selectors) {
    for (var i = 0; selectors && i < selectors.length; i++) {
        var elements;
        try { elements = doc.select(String(selectors[i])); } catch (e) { continue; }
        for (var j = 0; j < elements.size(); j++) {
            var element = elements.get(j), src = _ltString(element.attr("data-altimg")).trim();
            if (!src) continue;
            try {
                var img = doc.createElement("img");
                img.attr("src", src);
                element.replaceWith(img);
            } catch (e) {}
        }
    }
}

function _ltImageAnchorSrc(href, options) {
    var src = _ltString(href).trim();
    if (!src) return "";
    if (options.image_anchor_suffix) return src + _ltString(options.image_anchor_suffix);
    if (options.image_anchor_options) {
        try { return src + "," + JSON.stringify(options.image_anchor_options); } catch (e) {}
    }
    return src;
}

/* Keep real lazy-loaded images and source-specific image links working after DOM cleanup. */
function _ltPrepareImages(doc, baseUrl, options) {
    options = options || {};
    var images = doc.select("img"), lazyKeys = [
        "data-src", "data-original", "data-original-src", "data-lazy-src",
        "data-lazy", "data-echo", "data-img-src", "data-image-url",
        "data-image", "data-url", "data-fallback-src", "data-full-src",
        "data-hi-res-src", "data-large-file", "data-srcset"
    ];
    for (var i = 0; i < images.size(); i++) {
        var img = images.get(i), src = _ltString(img.attr("src")).trim();
        var loading = _ltString(img.attr("loading")).toLowerCase();
        var parent = img.parent();
        var href = parent && String(parent.tagName()).toLowerCase() === "a" ?
            _ltString(parent.attr("href")).trim() : "";
        var anchorChosen = false;
        var pictureSrc = "";
        if (parent && String(parent.tagName()).toLowerCase() === "picture") {
            var sources = parent.select("source"), sourceKeys = ["data-srcset", "srcset", "data-src", "src"];
            for (var ps = 0; ps < sources.size() && !_ltImageUsable(pictureSrc); ps++) {
                var source = sources.get(ps);
                for (var pk = 0; pk < sourceKeys.length; pk++) {
                    pictureSrc = _ltImageAttrCandidate(source, sourceKeys[pk]);
                    if (_ltImageUsable(pictureSrc)) break;
                }
            }
        }
        if (options.image_anchor_mode === "href" && loading === "lazy" && href) {
            src = _ltImageAnchorSrc(href, options);
            anchorChosen = true;
        }
        if (!anchorChosen && _ltImageUsable(pictureSrc)) src = pictureSrc;
        // Lazy pages often leave a usable thumbnail in src and the real
        // article image in data-src/data-original. Prefer the lazy candidate
        // whenever loading=lazy; otherwise the old code kept the thumbnail.
        if (loading === "lazy" && !anchorChosen) {
            var lazySrc = "";
            for (var k = 0; k < lazyKeys.length; k++) {
                var candidate = _ltImageAttrCandidate(img, lazyKeys[k]);
                if (_ltImageUsable(candidate)) { lazySrc = candidate; break; }
            }
            if (lazySrc) src = lazySrc;
        }
        if (!_ltImageUsable(src)) {
            for (var k2 = 0; k2 < lazyKeys.length && !_ltImageUsable(src); k2++)
                src = _ltImageAttrCandidate(img, lazyKeys[k2]);
            if (!_ltImageUsable(src)) src = _ltImageAttrCandidate(img, "srcset");
        }
        if (!_ltImageUsable(src) && href) {
            src = options.image_anchor_mode === "href" ? _ltImageAnchorSrc(href, options) : href;
        }
        if (src && /^\/\//.test(src)) src = "https:" + src;
        if (src && baseUrl && /^\//.test(src)) src = _ltString(baseUrl).replace(/\/$/, "") + src;
        if (src) img.attr("src", src);

        // A lazy placeholder without any real candidate must not survive as a
        // bare <img>. Legado's text reader can only recognize images with a
        // quoted src and otherwise renders the literal tag as article text.
        if (!src) {
            img.remove();
            continue;
        }

        // Legado's HTML reader consumes src; retaining arbitrary lazy-loading
        // attributes can make the tag display as text on some pages.
        var attrs = img.attributes().iterator();
        while (attrs.hasNext()) {
            var attr = attrs.next();
            if (String(attr.getKey()) !== "src" && String(attr.getKey()) !== "alt") attrs.remove();
        }
    }
}

function _ltCodecogs(doc, selector, java, cache) {
    if (!selector) return;
    var formulas;
    try { formulas = doc.select(selector); } catch (e) { return; }
    for (var i = 0; i < formulas.size(); i++) {
        var el = formulas.get(i), tex = _ltString(el.attr("data-tex") || el.attr("data-original-tex") || el.attr("alttext"));
        if (!tex) { var tm = el.select("tex-math").first(); tex = tm ? _ltString(tm.text()) : ""; }
        if (!tex) continue;
        try {
            var img = doc.createElement("img");
            img.attr("src", "https://latex.codecogs.com/svg.latex?" + encodeURIComponent(tex));
            img.attr("alt", tex); el.replaceWith(img);
        } catch (e) {}
    }
}

function _ltWiris(doc, selector, java, cache) {
    /* Preserve the old ScienceDirect contract: POST MathML to WIRIS, embed SVG,
       keep readable speech text, and leave the original formula on failure. */
    var formulas;
    try { formulas = doc.select(selector || "math"); } catch (e) { return; }
    for (var i = 0; i < formulas.size(); i++) {
        var el = formulas.get(i), mathml = _ltString(el.outerHtml());
        if (!mathml) continue;
        var imageSrc = "";
        try {
            var body = "mml=" + encodeURIComponent(mathml);
            var options = JSON.stringify({"method":"POST",
                "headers":{"Content-Type":"application/x-www-form-urlencoded"}, "body":body});
            var response = java.ajax("https://www.wiris.net/demo/editor/render?format=svg," + options);
            var svg = _ltString(response).trim();
            if (svg.indexOf("<svg") >= 0 && java.base64Encode)
                imageSrc = "data:image/svg+xml;base64," + java.base64Encode(svg);
        } catch (e) {
            try { java.log("WIRIS POST failed: " + e); } catch (ignore) {}
        }
        if (!imageSrc) continue;
        try {
            var speech = _ltString(el.attr("data-semantic-speech") || el.text()).replace(/\s+/g, " ").trim();
            var img = doc.createElement("img");
            img.attr("src", imageSrc); img.attr("alt", speech); el.replaceWith(img);
            if (speech) {
                var label = doc.createElement("span");
                label.addClass("formula-speech"); label.addClass("notranslate");
                label.text(" " + speech + " "); img.after(label);
            }
        } catch (e) {}
    }
}

/* One DOM pipeline for content and HTML TOCs. */
function TH(html, java, cache, options) {
    options = options || {};
    if (html == null || !_ltString(html).trim()) return html;
    var doc = org.jsoup.Jsoup.parse(_ltString(html));
    // Directory TH calls must not inherit a source's global content cleanup
    // array from jsLib. Content rules pass remove_selector explicitly.
    _ltRemove(doc, options.remove_selector || []);
    if (options.formula_mode === "codecogs" || (typeof formula_mode !== "undefined" && formula_mode === "codecogs"))
        _ltCodecogs(doc, options.formula_selector || (typeof formula_selector !== "undefined" ? formula_selector : "math"), java, cache);
    if (options.formula_mode === "wiris" || (typeof formula_mode !== "undefined" && formula_mode === "wiris"))
        _ltWiris(doc, options.formula_selector || (typeof formula_selector !== "undefined" ? formula_selector : "math"), java, cache);
    _ltExtract(doc, options.extract_selector || (typeof extract_selector !== "undefined" ? extract_selector : []));
    _ltReplaceAltImages(doc, options.image_alt_selector || []);
    _ltPrepareImages(doc, options.image_base_url || "", options);
    return TC(doc.body().html(), java, cache, options);
}
