/*
 * Trusted Types. The content policy asks the browser to refuse any string that is about to become code: innerHTML,
 * document.write, eval-like calls, a script or worker address. This file creates the only exception the app needs,
 * and it must run before everything else (it is the first script on the page, and has to be a file because inline
 * scripts are not allowed).
 *
 * The exception is the default policy, which the browser consults when a plain string meets a script-address sink
 * (registering the service worker is one). It lets through an address on the app's own origin and nothing else. HTML
 * and script sinks have no rule at all, so they stay closed: the app never writes HTML from a string.
 */
if (window.trustedTypes && window.trustedTypes.createPolicy) {
  window.trustedTypes.createPolicy('default', {
    createScriptURL: function (url) {
      var address = new URL(url, location.href)
      if (address.origin === location.origin) return address.href
      throw new TypeError('Blocked: a script address from another origin (' + address.origin + ')')
    },
  })
}
