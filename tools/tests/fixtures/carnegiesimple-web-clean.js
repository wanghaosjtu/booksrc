(function () {
  var selectors = 'script,noscript,style,svg,nav,aside,header,footer,form,button,input,iframe,[hidden],[aria-hidden="true"]';
  var nodes = document.querySelectorAll(selectors);
  for (var i = nodes.length - 1; i >= 0; i--) {
    var node = nodes[i];
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }
  return document.body ? document.body.outerHTML : document.documentElement.outerHTML;
})();
