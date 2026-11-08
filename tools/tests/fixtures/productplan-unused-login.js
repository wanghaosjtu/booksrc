function logAllVariables() {
  java.log("Global Variables:");
  for (var key in this) {
    if (this.hasOwnProperty(key)) {
      java.log(key + " = " + this[key]);
      java.log(key);
    }
  }
  java.log("Local Variables:");
  try {
    with ({}) {
      eval("for (var key in this) { if (this.hasOwnProperty(key)) { java.log(key); } }");
    }
  } catch (e) {
    java.log("Error logging local variables: " + e.message);
  }
  var targetLangFromSource = source.getLoginInfoMap().get("TARGET_LANG");
}
function setzhCHS() {
  java.put("TARGET_LANG", "zh-Hans");
}
function setlzh() {
  java.put("TARGET_LANG", "lzh");
}
function login() {}
