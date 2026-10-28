#!/usr/bin/env python3
"""Install the IEEE signed-media rule derived from ``calibre/ieee.recipe``.

IEEE's ``/mediastore`` endpoint rejects ordinary HTTP clients even with a
valid copied browser cookie.  Its documented Xplore flow first asks
``/rest/auth/signed-url`` for a short-lived URL.  This script changes only the
IEEE content rule so the source signs the large figure URL while parsing a
chapter; Legado's normal image downloader then fetches that signed URL.
"""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_FILE = ROOT / "booksource" / "legado-book-sources-current.json"

OLD = """    // Give every raw media element the required request context before TH
    // performs its one DOM cleanup/formula pass. This is the direct-endpoint equivalent of TH(result). Lazy anchors are then
    // upgraded by TH to the large original while keeping the same headers.
    var ieeeRawDoc = org.jsoup.Jsoup.parse(ieeeHtml);
    var ieeeRawImages = ieeeRawDoc.select('img[src]');
    for (var ieeeIndex = 0; ieeeIndex < ieeeRawImages.size(); ieeeIndex++) {
        var ieeeImage = ieeeRawImages.get(ieeeIndex);
        var ieeeSrc = String(ieeeImage.attr('src') || '');
        if (/^\\/\\//.test(ieeeSrc)) ieeeSrc = 'https:' + ieeeSrc;
        else if (/^\\//.test(ieeeSrc)) ieeeSrc = 'https://ieeexplore.ieee.org' + ieeeSrc;
        if (ieeeSrc.indexOf('ieeexplore.ieee.org/mediastore/') >= 0 && ieeeSrc.indexOf(',{') < 0) {
            ieeeImage.attr('src', ieeeSrc + ieeeOptions);
        }
    }
"""

NEW = """    // Do not send raw /mediastore URLs to Legado's image loader. IEEE's
    // WAF binds those requests to a Chromium TLS fingerprint, so merely
    // copying CloudFront cookies is insufficient. The official Xplore flow
    // asks /rest/auth/signed-url for an expiring media URL first (the same
    // browserless sequence used by calibre/ieee.recipe).
    var ieeeRawDoc = org.jsoup.Jsoup.parse(ieeeHtml);
    function ieeeMediaAbsolute(value) {
        var media = String(value || '').trim();
        if (/^\\/\\//.test(media)) return 'https:' + media;
        if (/^\\//.test(media)) return 'https://ieeexplore.ieee.org' + media;
        return media;
    }
    function ieeeSignedValue(value) {
        var signed = String(value || '').trim();
        if (signed.charAt(0) === '\\"') {
            try { signed = String(JSON.parse(signed)); } catch (ignore) {}
        }
        return /^https?:\\/\\//i.test(signed) ? signed : '';
    }
    function ieeeSignedMedia(resource) {
        var key = 'ieee:signed-media:v4:' + resource;
        try {
            var cached = cache.get(key);
            if (cached != null && /^https?:\/\//i.test(String(cached))) return String(cached);
        } catch (ignore) {}
        try {
            var endpoint = 'https://ieeexplore.ieee.org/rest/auth/signed-url?resource-url=' + encodeURIComponent(resource);
            var options = JSON.stringify({headers:{
                Accept:'text/plain, */*',
                Referer:ieeeReferer,
                'X-Security-Request':'required'
            }});
            var signed = ieeeSignedValue(java.ajax(endpoint + ',' + options));
            if (signed) {
                // Signed URLs expire in about five minutes; never retain them
                // long enough for a refreshed chapter to reuse an old one.
                try { cache.put(key, signed, 30); } catch (ignore) {}
                return signed;
            }
        } catch (error) {
            try { java.log('IEEE signed media request failed: ' + error); } catch (ignore) {}
        }
        return '';
    }
    var ieeeRawImages = ieeeRawDoc.select('img[src]');
    var ieeeSignedCount = 0;
    for (var ieeeIndex = 0; ieeeIndex < ieeeRawImages.size(); ieeeIndex++) {
        var ieeeImage = ieeeRawImages.get(ieeeIndex);
        var ieeeSrc = ieeeMediaAbsolute(ieeeImage.attr('src'));
        var ieeeParent = ieeeImage.parent();
        var ieeeHref = '';
        try {
            if (ieeeParent && String(ieeeParent.tagName()).toLowerCase() === 'a') {
                ieeeHref = ieeeMediaAbsolute(ieeeParent.attr('href'));
            }
        } catch (ignore) {}
        // Figure anchors point at the large original; otherwise retain the
        // page's image source. Both values are signed before image rendering.
        var ieeeResource = ieeeHref.indexOf('ieeexplore.ieee.org/mediastore/') >= 0 ? ieeeHref : ieeeSrc;
        if (ieeeResource.indexOf('ieeexplore.ieee.org/mediastore/') >= 0) {
            var ieeeSigned = ieeeSignedMedia(ieeeResource);
            if (ieeeSigned) {
                ieeeImage.attr('src', ieeeSigned);
                ieeeImage.removeAttr('loading');
                ieeeSignedCount++;
                try { if (ieeeParent) ieeeParent.attr('href', '#'); } catch (ignore) {}
            } else if (ieeeSrc.indexOf(',{') < 0) {
                // Preserve a direct path only as a diagnostic fallback.
                ieeeImage.attr('src', ieeeSrc + ieeeOptions);
            }
        }
    }
    try { java.log('IEEE signed media URLs: ' + ieeeSignedCount); } catch (ignore) {}

"""


def main() -> None:
    data = json.loads(SOURCE_FILE.read_text(encoding="utf-8"))
    source = next(item for item in data if item.get("bookSourceName") == "IEEE")
    content = source["ruleContent"]["content"]
    if ("/rest/auth/signed-url?resource-url=" in content and
            "function ieeeSignedMedia(resource)" in content):
        print("IEEE signed-media rule already installed")
        return
    if OLD not in content:
        raise SystemExit("expected IEEE direct-media block was not found")
    source["ruleContent"]["content"] = content.replace(OLD, NEW, 1)
    SOURCE_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("installed IEEE signed-media rule")


if __name__ == "__main__":
    main()
