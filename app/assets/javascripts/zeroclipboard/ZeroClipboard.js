/*!
* ZeroClipboard
* The ZeroClipboard library provides an easy way to copy text to the clipboard using an invisible Adobe Flash movie and a JavaScript interface.
* Copyright (c) 2014 Jon Rohan, James M. Greene
* Licensed MIT
* http://zeroclipboard.org/
* v1.3.5
*/

(function (window) {
  "use strict";

var currentElement;

/* Keep track of the state of the Flash object. */
var flashState = {
  // Flash object reference
  bridge: null,

  // Flash metadata
  version: "0.0.0",

  // Flash state
  disabled: null,
  outdated: null,
  ready: null
};

/* Keep track of data for the pending clipboard transaction. */
var _clipData = {};

/* Keep track of the ZeroClipboard client instance counter. */
var clientIdCounter = 0;

/*
 * Keep track of the state of the client instances.
 *
 * Entry structure:
 *   _clientMeta[client.id] = {
 *     instance: client,
 *     elements: [],
 *     handlers: {}
 *   };
 */
var _clientMeta = {};

/* Keep track of the ZeroClipboard clipped elements counter. */
var elementIdCounter = 0;

/*
 * Keep track of the state of the clipped element relationships to clients.
 *
 * Entry structure:
 *   _elementMeta[element.zcClippingId] = [client1.id, client2.id];
 */
var _elementMeta = {};

/* AMD module ID or path to access the ZeroClipboard object */
var _amdModuleId = null;

/* CommonJS module ID or path to access the ZeroClipboard object */
var _cjsModuleId = null;

/* The presumed location of the "ZeroClipboard.swf" file based on the location of the JS. */
var _swfPath = (function() {
  var i, jsDir, tmpJsPath, jsPath,
      swfPath = "ZeroClipboard.swf";
  // If this browser offers the `currentScript` feature
  if (document.currentScript && (jsPath = document.currentScript.src)) {
    // Do nothing, assignment occurred during condition
  }
  else {
    var scripts = document.getElementsByTagName("script");
    // If `script` elements have the `readyState` property in this browser
    if ("readyState" in scripts[0]) {
      for (i = scripts.length; i--; ) {
        if (scripts[i].readyState === "interactive" && (jsPath = scripts[i].src)) {
          // Do nothing, assignment occurred during condition
          break;
        }
      }
    }
    // If the document is still parsing, then the last script in the document is the one that is currently loading
    else if (document.readyState === "loading") {
      jsPath = scripts[scripts.length - 1].src;
    }
    // If every `script` has a `src` attribute AND they all come from the same directory
    else {
      for (i = scripts.length; i--; ) {
        tmpJsPath = scripts[i].src;
        if (!tmpJsPath) {
          jsDir = null;
          break;
        }
        tmpJsPath = tmpJsPath.split("#")[0].split("?")[0];
        tmpJsPath = tmpJsPath.slice(0, tmpJsPath.lastIndexOf("/") + 1);
        if (jsDir == null) {
          jsDir = tmpJsPath;
        }
        else if (jsDir !== tmpJsPath) {
          jsDir = null;
          break;
        }
      }
      if (jsDir !== null) {
        jsPath = jsDir;
      }
    }
    // Otherwise we cannot reliably know what script is executing....
  }
  if (jsPath) {
    jsPath = jsPath.split("#")[0].split("?")[0];
    swfPath = jsPath.slice(0, jsPath.lastIndexOf("/") + 1) + swfPath;
  }
  return swfPath;
})();
var _camelizeCssPropName = (function () {
  var matcherRegex = /\-([a-z])/g,
      replacerFn = function (match, group) { return group.toUpperCase(); };

  return function (prop) {
    return prop.replace(matcherRegex, replacerFn);
  };
})();

/*
 * Private function _getStyle is used to try and guess the element style; If
 * if we're looking for cursor, then we make a guess for <a>.
 *
 * returns the computed style
 */
var _getStyle = function (el, prop) {
  var value, camelProp, tagName, possiblePointers, i, len;

  if (window.getComputedStyle) {
    value = window.getComputedStyle(el, null).getPropertyValue(prop);
  }
  else {
    camelProp = _camelizeCssPropName(prop);

    if (el.currentStyle) {
      value = el.currentStyle[camelProp];
    }
    else {
      value = el.style[camelProp];
    }
  }

  if (prop === "cursor") {
    if (!value || value === "auto") {
      tagName = el.tagName.toLowerCase();
      if (tagName === "a") {
        return "pointer";
      }
    }
  }

  return value;
};

/*
 * The private mouseOver function for an element
 *
 * returns nothing
 */
var _elementMouseOver = function (event) {
  // IE usually doesn't pass the event
  if (!event) {
    event = window.event;
  }

  var target;
  // in IE7 this === window
  if (this !== window) {
    target = this;
  } else if (event.target) {
    target = event.target;
  } else if (event.srcElement) {
    target = event.srcElement;
  }

  // Set this as the new currently active element
  ZeroClipboard.activate(target);
};

// private function for adding events to the dom, IE before 9 is suckage
var _addEventHandler = function (element, method, func) {
  if (!element || element.nodeType !== 1) {
    return;
  }

  if (element.addEventListener) { // all browsers except IE before version 9
    element.addEventListener(method, func, false);
  } else if (element.attachEvent) { // IE before version 9
    element.attachEvent("on" + method, func);
  }
};

// private function for removing events from the dom, IE before 9 is suckage
var _removeEventHandler = function (element, method, func) {
  if (!element || element.nodeType !== 1) {
    return;
  }

  if (element.removeEventListener) { // all browsers except IE before version 9
    element.removeEventListener(method, func, false);
  } else if (element.detachEvent) { // IE before version 9
    element.detachEvent("on" + method, func);
  }
};

/*
 * This private function adds a class to the passed in element.
 *
 * returns the element with a new class
 */
var _addClass = function (element, value) {

  if (!element || element.nodeType !== 1) {
    return element;
  }

  // If the element has `classList`
  if (element.classList) {
    if (!element.classList.contains(value)) {
      element.classList.add(value);
    }
    return element;
  }

  if (value && typeof value === "string") {
    var classNames = (value || "").split(/\s+/);

    if (element.nodeType === 1) {
      if (!element.className) {
        element.className = value;
      } else {
        var className = " " + element.className + " ", setClass = element.className;
        for (var c = 0, cl = classNames.length; c < cl; c++) {
          if (className.indexOf(" " + classNames[c] + " ") < 0) {
            setClass += " " + classNames[c];
          }
        }
        // jank trim
        element.className = setClass.replace(/^\s+|\s+$/g, '');
      }
    }

  }

  return element;
};

/*
 * This private function removes a class from the provided elment
 *
 * returns the element without the class
 */
var _removeClass = function (element, value) {

  if (!element || element.nodeType !== 1) {
    return element;
  }

  // If the element has `classList`
  if (element.classList) {
    if (element.classList.contains(value)) {
      element.classList.remove(value);
    }
    return element;
  }

  if ((value && typeof value === "string") || value === undefined) {
    var classNames = (value || "").split(/\s+/);

    if (element.nodeType === 1 && element.className) {
      if (value) {
        var className = (" " + element.className + " ").replace(/[\n\t]/g, " ");
        for (var c = 0, cl = classNames.length; c < cl; c++) {
          className = className.replace(" " + classNames[c] + " ", " ");
        }
        // jank trim
        element.className = className.replace(/^\s+|\s+$/g, '');

      } else {
        element.className = "";
      }
    }

  }

  return element;
};

/*
 * private get the zoom factor of the document. Always returns 1, except at
 * non-default zoom levels in IE<8, and possibly some older versions of WebKit.
 *
 * returns floating unit percentage of the zoom factor (e.g. 150% = `1.5`)
 */
var _getZoomFactor = function () {
  var rect, physicalWidth, logicalWidth,
      zoomFactor = 1;
  if (typeof document.body.getBoundingClientRect === "function") {
    // rect is only in physical pixels in IE<8
    rect = document.body.getBoundingClientRect();
    physicalWidth = rect.right - rect.left;
    logicalWidth = document.body.offsetWidth;

    zoomFactor = Math.round((physicalWidth / logicalWidth) * 100) / 100;
  }
  return zoomFactor;
};

/*
 * private get the dom position of an object.
 *
 * returns json of object's position, height, width, and zIndex
 */
var _getDOMObjectPosition = function (obj, defaultZIndex) {
  // get absolute coordinates for dom element
  var info = {
    left:   0,
    top:    0,
    width:  0,
    height: 0,
    zIndex: _getSafeZIndex(defaultZIndex) - 1
  };

  // Use getBoundingClientRect where available (almost everywhere).
  // See: http://www.quirksmode.org/dom/w3c_cssom.html
  if (obj.getBoundingClientRect) {
    // compute left / top offset (works for `position:fixed`, too!)
    var rect = obj.getBoundingClientRect();
    var pageXOffset, pageYOffset, zoomFactor;

    // IE<9 doesn't support `pageXOffset`/`pageXOffset`
    if ("pageXOffset" in window && "pageYOffset" in window) {
      pageXOffset = window.pageXOffset;
      pageYOffset = window.pageYOffset;
    }
    else {
      zoomFactor = _getZoomFactor();
      pageXOffset = Math.round(document.documentElement.scrollLeft / zoomFactor);
      pageYOffset = Math.round(document.documentElement.scrollTop / zoomFactor);
    }

    // `clientLeft`/`clientTop` are to fix IE's 2px offset in standards mode
    var leftBorderWidth = document.documentElement.clientLeft || 0;
    var topBorderWidth = document.documentElement.clientTop || 0;

    info.left = rect.left + pageXOffset - leftBorderWidth;
    info.top = rect.top + pageYOffset - topBorderWidth;
    info.width = "width" in rect ? rect.width : rect.right - rect.left;
    info.height = "height" in rect ? rect.height : rect.bottom - rect.top;
  }

  return info;
};

/*
 * private _cacheBust function.
 * Will look at a path, and will append "?noCache={time}" or "&noCache={time}" to path.
 * because ExternalInterface craps out when Flash is cached in IE.
 *
 * returns path with noCache param added
 */
var _cacheBust = function (path, options) {
  var cacheBust = options == null || (options && options.cacheBust === true && options.useNoCache === true);
  if (cacheBust) {
    return (path.indexOf("?") === -1 ? "?" : "&") + "noCache=" + (new Date()).getTime();
  } else {
    return "";
  }
};

/*
 * private _vars function.
 * creates a query string for the flashvars
 *
 * returns flashvars separated by &
 */
var _vars = function (options) {
  var i, len, domain,
      str = [],
      domains = [],
      trustedOriginsExpanded = [];

  /** @deprecated `trustedOrigins` in [v1.3.0], slated for removal in [v2.0.0]. See docs for more info. */
  if (options.trustedOrigins) {
    if (typeof options.trustedOrigins === "string") {
      domains.push(options.trustedOrigins);
    }
    else if (typeof options.trustedOrigins === "object" && "length" in options.trustedOrigins) {
      domains = domains.concat(options.trustedOrigins);
    }
  }
  if (options.trustedDomains) {
    if (typeof options.trustedDomains === "string") {
      domains.push(options.trustedDomains);
    }
    else if (typeof options.trustedDomains === "object" && "length" in options.trustedDomains) {
      domains = domains.concat(options.trustedDomains);
    }
  }
  if (domains.length) {
    for (i = 0, len = domains.length; i < len; i++) {
      if (domains.hasOwnProperty(i) && domains[i] && typeof domains[i] === "string") {
        domain = _extractDomain(domains[i]);

        if (!domain) {
          continue;
        }

        // If we encounter a wildcard, ignore everything else as they are irrelevant
        if (domain === "*") {
          trustedOriginsExpanded = [domain];
          break;
        }

        // Add the domain, relative protocol + domain, and absolute protocol + domain ("origin")
        // because Flash Player seems to handle these inconsistently (perhaps in different versions)
        trustedOriginsExpanded.push.apply(
          trustedOriginsExpanded,
          [
            domain,
            "//" + domain,
            window.location.protocol + "//" + domain
          ]
        );
      }
    }
  }
  if (trustedOriginsExpanded.length) {
    str.push("trustedOrigins=" + encodeURIComponent(trustedOriginsExpanded.join(",")));
  }

  // if ZeroClipboard is loaded as an AMD/CommonJS module
  if (typeof options.jsModuleId === "string" && options.jsModuleId) {
    str.push("jsModuleId=" + encodeURIComponent(options.jsModuleId));
  }

  // join the str by &
  return str.join("&");
};

/*
 * private _inArray function.
 * gets the index of an elem in an array
 *
 * returns the index of an element in the array, -1 if not found
 */
var _inArray = function (elem, array, fromIndex) {
  if (typeof array.indexOf === "function") {
    return array.indexOf(elem, fromIndex);
  }

  var i,
      len = array.length;
  if (typeof fromIndex === "undefined") {
    fromIndex = 0;
  } else if (fromIndex < 0) {
    fromIndex = len + fromIndex;
  }
  for (i = fromIndex; i < len; i++) {
    if (array.hasOwnProperty(i) && array[i] === elem) {
      return i;
    }
  }

  return -1;
};

/*
 * private _prepClip function.
 * prepares the elements for clipping/unclipping
 *
 * returns the elements
 */
var _prepClip = function (elements) {

  // if elements is a string
  if (typeof elements === "string") throw new TypeError("ZeroClipboard doesn't accept query strings.");

  // if the elements isn't an array
  if (!elements.length) return [elements];

  return elements;
};


/*
 * private _dispatchCallback
 * used to control if callback should be executed asynchronously or not
 *
 * returns nothing
 */
var _dispatchCallback = function (func, context, args, async) {
  if (async) {
    window.setTimeout(function () {
      func.apply(context, args);
    }, 0);
  }
  else {
    func.apply(context, args);
  }
};


/*
 * private _getSafeZIndex
 * Used to get a safe and numeric value for `zIndex`
 *
 * returns an integer greater than 0
 */
var _getSafeZIndex = function (val) {
  var zIndex, tmp;

  if (val) {
    if (typeof val === "number" && val > 0) {
      zIndex = val;
    }
    else if (typeof val === "string" && (tmp = parseInt(val, 10)) && !isNaN(tmp) && tmp > 0) {
      zIndex = tmp;
    }
  }

  if (!zIndex) {
    if (typeof _globalConfig.zIndex === "number" && _globalConfig.zIndex > 0) {
      zIndex = _globalConfig.zIndex;
    }
    else if (typeof _globalConfig.zIndex === "string" && (tmp = parseInt(_globalConfig.zIndex, 10)) && !isNaN(tmp) && tmp > 0) {
      zIndex = tmp;
    }
  }

  return zIndex || 0;
};


/*
 * private _deprecationWarning
 * If `console` is available, issue a `console.warn`/`console.log` warning against the use of
 * deprecated methods.
 *
 * returns void
 */
var _deprecationWarning = function(deprecatedApiName, debugEnabled) {
  if (deprecatedApiName && debugEnabled !== false && typeof console !== "undefined" && console && (console.warn || console.log)) {
    var deprecationWarning = "`" + deprecatedApiName + "` is deprecated. See docs for more info:\n" +
          "    https://github.com/zeroclipboard/zeroclipboard/blob/master/docs/instructions.md#deprecations";
    if (console.warn) {
      console.warn(deprecationWarning);
    }
    else {
      console.log(deprecationWarning);
    }
  }
};


/*
 * Shallow-copy the owned properties of one object over to another, similar to jQuery's `$.extend`.
 * @returns the target object
 * @private
 */
var _extend = function() {
  var i, len, arg, prop, src, copy,
      target = arguments[0] || {};

  for (i = 1, len = arguments.length; i < len; i++) {
    // Only deal with non-null/undefined values
    if ((arg = arguments[i]) != null) {
      // Extend the base object
      for (prop in arg) {
        if (arg.hasOwnProperty(prop)) {
          src = target[prop];
          copy = arg[prop];

          // Prevent never-ending loops
          if (target === copy) {
            continue;
          }

          // Don't bring in undefined values
          if (copy !== undefined) {
            target[prop] = copy;
          }
        }
      }
    }
  }
  return target;
};


/*
 * Extract the domain (e.g. "github.com") from an origin (e.g. "https://github.com") or
 * URL (e.g. "https://github.com/zeroclipboard/zeroclipboard/").
 * @returns the domain
 * @private
 */
var _extractDomain = function(originOrUrl) {
  if (originOrUrl == null || originOrUrl === "") {
    return null;
  }

  // Trim
  originOrUrl = originOrUrl.replace(/^\s+|\s+$/g, "");
  if (originOrUrl === "") {
    return null;
  }

  // Strip the protocol, if any was provided
  var protocolIndex = originOrUrl.indexOf("//");
  originOrUrl = protocolIndex === -1 ? originOrUrl : originOrUrl.slice(protocolIndex + 2);

  // Strip the path, if any was provided
  var pathIndex = originOrUrl.indexOf("/");
  originOrUrl = pathIndex === -1 ? originOrUrl : protocolIndex === -1 || pathIndex === 0 ? null : originOrUrl.slice(0, pathIndex);

  if (originOrUrl && originOrUrl.slice(-4).toLowerCase() === ".swf") {
    return null;
  }
  return originOrUrl || null;
};


/**
 * Set `allowScriptAccess` based on `trustedDomains` and `window.location.host` vs. `moviePath`
 * @private
 */
var _determineScriptAccess = (function() {
  var _extractAllDomains = function(origins, resultsArray) {
    var i, len, tmp;
    if (origins != null && resultsArray[0] !== "*") {
      if (typeof origins === "string") {
        origins = [origins];
      }
      if (typeof origins === "object" && "length" in origins) {
        for (i = 0, len = origins.length; i < len; i++) {
          if (origins.hasOwnProperty(i)) {
            tmp = _extractDomain(origins[i]);
            if (tmp) {
              if (tmp === "*") {
                resultsArray.length = 0;
                resultsArray.push("*");
                break;
              }
              if (_inArray(tmp, resultsArray) === -1) {
                resultsArray.push(tmp);
              }
            }
          }
        }
      }
    }
  };

  var _accessLevelLookup = {
    "always": "always",
    "samedomain": "sameDomain",
    "never": "never"
  };

  return function(currentDomain, configOptions) {
    var asaLower,
        allowScriptAccess = configOptions.allowScriptAccess;

    if (typeof allowScriptAccess === "string" && (asaLower = allowScriptAccess.toLowerCase()) && /^always|samedomain|never$/.test(asaLower)) {
      return _accessLevelLookup[asaLower];
    }
    // else...

    // Get SWF domain
    var swfDomain = _extractDomain(configOptions.moviePath);
    if (swfDomain === null) {
      swfDomain = currentDomain;
    }
    // Get all trusted domains
    var trustedDomains = [];
    _extractAllDomains(configOptions.trustedOrigins, trustedDomains);
    _extractAllDomains(configOptions.trustedDomains, trustedDomains);

    var len = trustedDomains.length;
    if (len > 0) {
      if (len === 1 && trustedDomains[0] === "*") {
        return "always";
      }
      if (_inArray(currentDomain, trustedDomains) !== -1) {
        if (len === 1 && currentDomain === swfDomain) {
          return "sameDomain";
        }
        return "always";
      }
    }
    return "never";
  };
})();


/**
 * Get all of an object's owned, enumerable property names, Does NOT include prototype properties.
 * @returns an array of property names
 * @private
 */
var _objectKeys = function (obj) {
  // Avoid the impending `TypeError`
  if (obj == null) {
    return [];
  }
  if (Object.keys) {
    return Object.keys(obj);
  }
  var keys = [];
  for (var prop in obj) {
    if (obj.hasOwnProperty(prop)) {
      keys.push(prop);
    }
  }
  return keys;
};


/**
 * Remove all owned properties from an object.
 *
 * @returns the original object with its owned properties
 *
 * @private
 */
var _deleteOwnProperties = function(obj) {
  if (obj) {
    for (var prop in obj) {
      if (obj.hasOwnProperty(prop)) {
        delete obj[prop];
      }
    }
  }
  return obj;
};


/**
 * Get the currently active/focused DOM element.
 *
 * @returns the currently active/focused element, or `null`
 *
 * @private
 */
var _safeActiveElement = function() {
  try {
    return document.activeElement;
  }
  catch (err) {
    // Do nothing
  }
  return null;
};
var _detectFlashSupport = function () {
  var hasFlash = false;

  if (typeof flashState.disabled === "boolean") {
    hasFlash = flashState.disabled === false;
  }
  else {
    // IE
    if (typeof ActiveXObject === "function") {
      try {
        if (new ActiveXObject("ShockwaveFlash.ShockwaveFlash")) {
          hasFlash = true;
        }
      }
      catch (error) {}
    }

    // Every other browser
    if (!hasFlash && navigator.mimeTypes["application/x-shockwave-flash"]) {
      hasFlash = true;
    }
  }

  return hasFlash;
};


/*
 * Parse a Flash version string (e.g. "MAC 11,9,100")
 *
 * returns a cleaner Flash version string (e.g. "11.9.100")
 */
function _parseFlashVersion(flashVersion) {
  return flashVersion.replace(/,/g, ".").replace(/[^0-9\.]/g, "");
}


/*
 * Flash version verification
 *
 * returns true if Flash version is acceptable
 */
function _isFlashVersionSupported(flashVersion) {
  return parseFloat(_parseFlashVersion(flashVersion)) >= 10.0;
}
var ZeroClipboard = function (elements, /** @deprecated */ options) {

  // Ensure the constructor is invoked with the `new` keyword, even if the user forgets it
  if (!(this instanceof ZeroClipboard)) {
    return new ZeroClipboard(elements, options);
  }

  // Assign an ID to the client instance
  this.id = "" + (clientIdCounter++);

  // Create the meta information store for this client
  _clientMeta[this.id] = {
    instance: this,
    elements: [],
    handlers: {}
  };

  // If the elements argument exists, clip it
  if (elements) {
    this.clip(elements);
  }

  // Warn about use of deprecated constructor signature
  if (typeof options !== "undefined") {
    _deprecationWarning("new ZeroClipboard(elements, options)", _globalConfig.debug);

    // Set and override the defaults
    ZeroClipboard.config(options);
  }

  /** @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for more info. */
  this.options = ZeroClipboard.config();

  // Flash status
  if (typeof flashState.disabled !== "boolean") {
    flashState.disabled = !_detectFlashSupport();
  }

  // Setup the Flash <-> JavaScript bridge
  if (flashState.disabled === false && flashState.outdated !== true) {
    if (flashState.bridge === null) {
      flashState.outdated = false;
      flashState.ready = false;
      _bridge();
    }
  }
};


/*
 * Sends a signal to the Flash object to set the clipboard text.
 *
 * returns object instance
 */
ZeroClipboard.prototype.setText = function (newText) {
  if (newText && newText !== "") {
    _clipData["text/plain"] = newText;
    if (flashState.ready === true && flashState.bridge && typeof flashState.bridge.setText === "function") {
      flashState.bridge.setText(newText);
    }
    else {
      flashState.ready = false;
    }
  }
  return this;
};


/*
 * Sends a signal to the Flash object to change the stage size/dimensions.
 *
 * returns object instance
 */
ZeroClipboard.prototype.setSize = function (width, height) {
  if (flashState.ready === true && flashState.bridge && typeof flashState.bridge.setSize === "function") {
    flashState.bridge.setSize(width, height);
  }
  else {
    flashState.ready = false;
  }
  return this;
};


/*
 * @private
 *
 * Sends a signal to the Flash object to display the hand cursor if true.
 * Does NOT update the value of the `forceHandCursor` option.
 *
 * returns nothing
 */
var _setHandCursor = function (enabled) {
  if (flashState.ready === true && flashState.bridge && typeof flashState.bridge.setHandCursor === "function") {
    flashState.bridge.setHandCursor(enabled);
  }
  else {
    flashState.ready = false;
  }
};


/*
 * Self-destruction and clean up everything for a single client.
 *
 * returns nothing
 */
ZeroClipboard.prototype.destroy = function () {
  // Unclip all the elements
  this.unclip();

  // Remove all event handlers
  this.off();

  // Delete the client's metadata store
  delete _clientMeta[this.id];
};


/*
 * Get all clients.
 *
 * returns array of clients
 */
var _getAllClients = function () {
  var i, len, client,
      clients = [],
      clientIds = _objectKeys(_clientMeta);
  for (i = 0, len = clientIds.length; i < len; i++) {
    client = _clientMeta[clientIds[i]].instance;
    if (client && client instanceof ZeroClipboard) {
      clients.push(client);
    }
  }
  return clients;
};
ZeroClipboard.version = "1.3.5";

// ZeroClipboard options defaults
var _globalConfig = {
  // NOTE: For versions >= v1.3.x and < v2.x, you must use `swfPath` by setting `moviePath`:
  //   `ZeroClipboard.config({ moviePath: ZeroClipboard.config("swfPath") });`
  // URL to movie, relative to the page. Default value will be "ZeroClipboard.swf" under the
  // same path as the ZeroClipboard JS file.
  swfPath: _swfPath,

  // SWF inbound scripting policy: page domains that the SWF should trust. (single string or array of strings)
  trustedDomains: window.location.host ? [window.location.host] : [],

  // Include a "nocache" query parameter on requests for the SWF
  cacheBust: true,

  // Forcibly set the hand cursor ("pointer") for all clipped elements
  forceHandCursor: false,

  // The z-index used by the Flash object. Max value (32-bit): 2147483647
  zIndex: 999999999,

  // Debug enabled: send `console` messages with deprecation warnings, etc.
  debug: true,

  // Sets the title of the `div` encapsulating the Flash object
  title: null,

  // Setting this to `false` would allow users to handle calling `ZeroClipboard.activate(...);`
  // themselves instead of relying on our per-element `mouseover` handler
  autoActivate: true
};


/*
 * Update or get a copy of the ZeroClipboard global configuration.
 *
 * returns a copy of the updated configuration
 */
ZeroClipboard.config = function (options) {
  if (typeof options === "object" && options !== null) {
    _extend(_globalConfig, options);
  }
  if (typeof options === "string" && options) {
    if (_globalConfig.hasOwnProperty(options)) {
      return _globalConfig[options];
    }
    // else `return undefined;`
    return;
  }
  // Make a deep copy of the config object
  var copy = {};
  for (var prop in _globalConfig) {
    if (_globalConfig.hasOwnProperty(prop)) {
      if (typeof _globalConfig[prop] === "object" && _globalConfig[prop] !== null) {
        if ("length" in _globalConfig[prop]) {
          copy[prop] = _globalConfig[prop].slice(0);
        }
        else {
          copy[prop] = _extend({}, _globalConfig[prop]);
        }
      }
      else {
        copy[prop] = _globalConfig[prop];
      }
    }
  }
  return copy;
};


/*
 * Self-destruction and clean up everything
 *
 * returns nothing
 */
ZeroClipboard.destroy = function () {
  // Deactivate the active element, if any
  ZeroClipboard.deactivate();

  // Invoke `destroy` on each client instance
  for (var clientId in _clientMeta) {
    if (_clientMeta.hasOwnProperty(clientId) && _clientMeta[clientId]) {
      var client = _clientMeta[clientId].instance;
      if (client && typeof client.destroy === "function") {
        client.destroy();
      }
    }
  }

  // Remove the Flash bridge
  var htmlBridge = _getHtmlBridge(flashState.bridge);
  if (htmlBridge && htmlBridge.parentNode) {
    htmlBridge.parentNode.removeChild(htmlBridge);
    flashState.ready = null;
    flashState.bridge = null;
  }
};


/*
 * Sets the current HTML object that the Flash object should overlay. This will put the global Flash object on top of
 * the current element; depending on the setup, this may also set the pending clipboard text data as well as the Flash
 * object's wrapping element's title attribute based on the underlying HTML element and ZeroClipboard configuration.
 *
 * returns nothing
 */
ZeroClipboard.activate = function(element) {
  // "Ignore" the currently active element
  if (currentElement) {
    _removeClass(currentElement, _globalConfig.hoverClass);
    _removeClass(currentElement, _globalConfig.activeClass);
  }

  // Mark the element as currently activated
  currentElement = element;

  // Add the hover class
  _addClass(element, _globalConfig.hoverClass);

  // Move the Flash object
  _reposition();

  // If the element has a title, mimic it
  var newTitle = _globalConfig.title || element.getAttribute("title");
  if (newTitle) {
    var htmlBridge = _getHtmlBridge(flashState.bridge);
    if (htmlBridge) {
      htmlBridge.setAttribute("title", newTitle);
    }
  }

  // If the element has a pointer style, set to hand cursor
  var useHandCursor = _globalConfig.forceHandCursor === true || _getStyle(element, "cursor") === "pointer";
  // Update the hand cursor state without updating the `forceHandCursor` option
  _setHandCursor(useHandCursor);
};


/*
 * Un-overlays the Flash object. This will put the global Flash object off-screen; depending on the setup, this may
 * also unset the Flash object's wrapping element's title attribute based on the underlying HTML element and
 * ZeroClipboard configuration.
 *
 * returns nothing
 */
ZeroClipboard.deactivate = function() {
  // Hide the Flash object off-screen
  var htmlBridge = _getHtmlBridge(flashState.bridge);
  if (htmlBridge) {
    htmlBridge.style.left = "0px";
    htmlBridge.style.top = "-9999px";
    htmlBridge.removeAttribute("title");
  }

  // "Ignore" the currently active element
  if (currentElement) {
    _removeClass(currentElement, _globalConfig.hoverClass);
    _removeClass(currentElement, _globalConfig.activeClass);
    currentElement = null;
  }
};
var _bridge = function () {
  var flashBridge, len;

  // try and find the current global bridge
  var container = document.getElementById("global-zeroclipboard-html-bridge");

  if (!container) {
    // Get a copy of the `_globalConfig` object to avoid exposing
    // the `amdModuleId` and `cjsModuleId` settings
    var opts = ZeroClipboard.config();
    // Set these last to override them just in case any [v1.2.0-beta.1] users
    // are still passing them in to [v1.2.0-beta.2] (or higher)
    opts.jsModuleId =
      (typeof _amdModuleId === "string" && _amdModuleId) ||
      (typeof _cjsModuleId === "string" && _cjsModuleId) ||
      null;

    // Set `allowScriptAccess` based on `trustedDomains` and `window.location.host` vs. `moviePath`
    var allowScriptAccess = _determineScriptAccess(window.location.host, _globalConfig);

    var flashvars = _vars(opts);
    var swfUrl = _globalConfig.moviePath + _cacheBust(_globalConfig.moviePath, _globalConfig);
    var html = "\
      <object classid=\"clsid:d27cdb6e-ae6d-11cf-96b8-444553540000\" id=\"global-zeroclipboard-flash-bridge\" width=\"100%\" height=\"100%\"> \
        <param name=\"movie\" value=\"" + swfUrl + "\"/> \
        <param name=\"allowScriptAccess\" value=\"" + allowScriptAccess +  "\"/> \
        <param name=\"scale\" value=\"exactfit\"/> \
        <param name=\"loop\" value=\"false\"/> \
        <param name=\"menu\" value=\"false\"/> \
        <param name=\"quality\" value=\"best\" /> \
        <param name=\"bgcolor\" value=\"#ffffff\"/> \
        <param name=\"wmode\" value=\"transparent\"/> \
        <param name=\"flashvars\" value=\"" + flashvars + "\"/> \
        <embed src=\"" + swfUrl + "\" \
          loop=\"false\" menu=\"false\" \
          quality=\"best\" bgcolor=\"#ffffff\" \
          width=\"100%\" height=\"100%\" \
          name=\"global-zeroclipboard-flash-bridge\" \
          allowScriptAccess=\"" + allowScriptAccess +  "\" \
          allowFullScreen=\"false\" \
          type=\"application/x-shockwave-flash\" \
          wmode=\"transparent\" \
          pluginspage=\"http://www.macromedia.com/go/getflashplayer\" \
          flashvars=\"" + flashvars + "\" \
          scale=\"exactfit\"> \
        </embed> \
      </object>";

    container = document.createElement("div");
    container.id = "global-zeroclipboard-html-bridge";
    container.setAttribute("class", "global-zeroclipboard-container");
    container.style.position = "absolute";
    container.style.left = "0px";
    container.style.top = "-9999px";
    container.style.width = "15px";
    container.style.height = "15px";
    container.style.zIndex = "" + _getSafeZIndex(_globalConfig.zIndex);

    // NOTE: Fixes https://github.com/zeroclipboard/zeroclipboard/issues/204
    // Although many web developers will tell you that the following 2 lines should be switched to
    // avoid unnecessary reflows, that is (a) not true in modern browsers, and (b) will actually
    // BREAK this particular bit of code in oldIE (IE8, at least, if not IE7 as well). Something
    // odd about oldIE and its parsing of plugin HTML....
    document.body.appendChild(container);
    container.innerHTML = html;
  }

  flashBridge = document["global-zeroclipboard-flash-bridge"];
  if (flashBridge && (len = flashBridge.length)) {
    flashBridge = flashBridge[len - 1];
  }
  flashState.bridge = flashBridge || container.children[0].lastElementChild;
};


/*
 * Get the HTML element container that wraps the Flash bridge object/element.
 * @private
 */
var _getHtmlBridge = function(flashBridge) {
  var isFlashElement = /^OBJECT|EMBED$/;
  var htmlBridge = flashBridge && flashBridge.parentNode;
  while (htmlBridge && isFlashElement.test(htmlBridge.nodeName) && htmlBridge.parentNode) {
    htmlBridge = htmlBridge.parentNode;
  }
  return htmlBridge || null;
};


/*
 * Reposition the Flash object to cover the current element being hovered over.
 *
 * returns object instance
 */
var _reposition = function () {

  // If there is no `currentElement`, skip it
  if (currentElement) {
    var pos = _getDOMObjectPosition(currentElement, _globalConfig.zIndex);

    // new css
    var htmlBridge = _getHtmlBridge(flashState.bridge);
    if (htmlBridge) {
      htmlBridge.style.top    = pos.top + "px";
      htmlBridge.style.left   = pos.left + "px";
      htmlBridge.style.width  = pos.width + "px";
      htmlBridge.style.height = pos.height + "px";
      htmlBridge.style.zIndex = pos.zIndex + 1;
    }

    if (flashState.ready === true && flashState.bridge && typeof flashState.bridge.setSize === "function") {
      flashState.bridge.setSize(pos.width, pos.height);
    }
    else {
      flashState.ready = false;
    }
  }

  return this;
};
ZeroClipboard.prototype.on = function (eventName, func) {
  // add user event handler for event
  var i, len, events,
      added = {},
      handlers = _clientMeta[this.id] && _clientMeta[this.id].handlers;

  if (typeof eventName === "string" && eventName) {
    events = eventName.toLowerCase().split(/\s+/);
  }
  else if (typeof eventName === "object" && eventName && typeof func === "undefined") {
    for (i in eventName) {
      if (eventName.hasOwnProperty(i) && typeof i === "string" && i && typeof eventName[i] === "function") {
        this.on(i, eventName[i]);
      }
    }
  }

  if (events && events.length) {
    for (i = 0, len = events.length; i < len; i++) {
      eventName = events[i].replace(/^on/, '');
      added[eventName] = true;
      if (!handlers[eventName]) {
        handlers[eventName] = [];
      }
      handlers[eventName].push(func);
    }

    // The following events must be memorized and fired immediately if relevant as they only occur
    // once per Flash object load.

    // If we don't have Flash, tell an adult
    if (added.noflash && flashState.disabled) {
      _receiveEvent.call(this, "noflash", {});
    }
    // If we have old Flash, cry about it
    if (added.wrongflash && flashState.outdated) {
      _receiveEvent.call(this, "wrongflash", {
        flashVersion: flashState.version
      });
    }
    // If the SWF was already loaded, we're à gogo!
    if (added.load && flashState.ready) {
      _receiveEvent.call(this, "load", {
        flashVersion: flashState.version
      });
    }
  }

  return this;
};

/*
 * Remove an event handler from the client.
 * If no handler function/object is provided, it will remove all handlers for the provided event type.
 * If no event name is provided, it will remove all handlers for every event type.
 *
 * returns object instance
 */
ZeroClipboard.prototype.off = function (eventName, func) {
  var i, len, foundIndex, events, perEventHandlers,
      handlers = _clientMeta[this.id] && _clientMeta[this.id].handlers;
  if (arguments.length === 0) {
    // Remove ALL of the handlers for ALL event types
    events = _objectKeys(handlers);
  }
  else if (typeof eventName === "string" && eventName) {
    events = eventName.split(/\s+/);
  }
  else if (typeof eventName === "object" && eventName && typeof func === "undefined") {
    for (i in eventName) {
      if (eventName.hasOwnProperty(i) && typeof i === "string" && i && typeof eventName[i] === "function") {
        this.off(i, eventName[i]);
      }
    }
  }

  if (events && events.length) {
    for (i = 0, len = events.length; i < len; i++) {
      eventName = events[i].toLowerCase().replace(/^on/, "");
      perEventHandlers = handlers[eventName];
      if (perEventHandlers && perEventHandlers.length) {
        if (func) {
          foundIndex = _inArray(func, perEventHandlers);
          while (foundIndex !== -1) {
            perEventHandlers.splice(foundIndex, 1);
            foundIndex = _inArray(func, perEventHandlers, foundIndex);
          }
        }
        else {
          // If no `func` was provided, remove ALL of the handlers for this event type
          handlers[eventName].length = 0;
        }
      }
    }
  }
  return this;
};


/*
 * Retrieve event handlers for an event type from the client.
 * If no event name is provided, it will remove all handlers for every event type.
 *
 * returns array of handlers for the event type; if no event type, then a map/hash object of handlers for all event types; or `null`
 */
ZeroClipboard.prototype.handlers = function (eventName) {
  var prop,
      copy = null,
      handlers = _clientMeta[this.id] && _clientMeta[this.id].handlers;

  if (handlers) {
    if (typeof eventName === "string" && eventName) {
      return handlers[eventName] ? handlers[eventName].slice(0) : null;
    }

    // Make a deep copy of the handlers object
    copy = {};
    for (prop in handlers) {
      if (handlers.hasOwnProperty(prop) && handlers[prop]) {
        copy[prop] = handlers[prop].slice(0);
      }
    }
  }
  return copy;
};


/**
 * Handle the actual dispatching of events to client instances.
 *
 * returns object instance
 */
var _dispatchClientCallbacks = function(eventName, context, args, async) {
  // User defined handlers for events
  var handlers = _clientMeta[this.id] && _clientMeta[this.id].handlers[eventName];
  if (handlers && handlers.length) {
    var i, len, func,
        originalContext = context || this;
    for (i = 0, len = handlers.length; i < len; i++) {
      func = handlers[i];
      context = originalContext;

      // If the user provided a string for their callback, grab that function
      if (typeof func === 'string' && typeof window[func] === 'function') {
        func = window[func];
      }
      if (typeof func === 'object' && func && typeof func.handleEvent === 'function') {
        context = func;
        func = func.handleEvent;
      }
      if (typeof func === 'function') {
        // actual function reference
        _dispatchCallback(func, context, args, async);
      }
    }
  }
  return this;
};

/*
 * Register new element(s) to the object.
 *
 * returns object instance
 */
ZeroClipboard.prototype.clip = function (elements) {

  elements = _prepClip(elements);

  for (var i = 0; i < elements.length ; i++) {
    if (elements.hasOwnProperty(i) && elements[i] && elements[i].nodeType === 1) {
      // If the element hasn't been clipped to ANY client yet, add a metadata ID and event handler
      if (!elements[i].zcClippingId) {
        elements[i].zcClippingId = "zcClippingId_" + (elementIdCounter++);
        _elementMeta[elements[i].zcClippingId] = [this.id];
        if (_globalConfig.autoActivate === true) {
          _addEventHandler(elements[i], "mouseover", _elementMouseOver);
        }
      }
      else if (_inArray(this.id, _elementMeta[elements[i].zcClippingId]) === -1) {
        _elementMeta[elements[i].zcClippingId].push(this.id);
      }

      // If the element hasn't been clipped to THIS client yet, add it
      var clippedElements = _clientMeta[this.id].elements;
      if (_inArray(elements[i], clippedElements) === -1) {
        clippedElements.push(elements[i]);
      }
    }
  }

  return this;
};

/*
 * Unregister the clipboard actions of previously registered element(s) on the page.
 * If no elements are provided, ALL registered elements will be unregistered.
 *
 * returns object instance
 */
ZeroClipboard.prototype.unclip = function (elements) {
  var meta = _clientMeta[this.id];

  if (meta) {
    var clippedElements = meta.elements;
    var arrayIndex;

    // if no elements were provided, unclip ALL of this client's clipped elements
    if (typeof elements === "undefined") {
      elements = clippedElements.slice(0);
    }
    else {
      elements = _prepClip(elements);
    }
    
    for (var i = elements.length; i--; ) {
      if (elements.hasOwnProperty(i) && elements[i] && elements[i].nodeType === 1) {
        // If the element was clipped to THIS client yet, remove it
        arrayIndex = 0;
        while ((arrayIndex = _inArray(elements[i], clippedElements, arrayIndex)) !== -1) {
          clippedElements.splice(arrayIndex, 1);
        }

        // If the element isn't clipped to ANY other client, remove its metadata ID and event handler
        var clientIds = _elementMeta[elements[i].zcClippingId];
        if (clientIds) {
          arrayIndex = 0;
          while ((arrayIndex = _inArray(this.id, clientIds, arrayIndex)) !== -1) {
            clientIds.splice(arrayIndex, 1);
          }
          if (clientIds.length === 0) {
            if (_globalConfig.autoActivate === true) {
              _removeEventHandler(elements[i], "mouseover", _elementMouseOver);
            }
            delete elements[i].zcClippingId;
          }
        }
      }
    }
  }
  return this;
};


/*
 * Get all of the elements to which this client is clipped.
 *
 * returns array of clipped elements
 */
ZeroClipboard.prototype.elements = function () {
  var meta = _clientMeta[this.id];
  return (meta && meta.elements) ? meta.elements.slice(0) : [];
};


/*
 * Get all of the clients that are clipped to an element.
 *
 * returns array of clients
 */
var _getAllClientsClippedToElement = function (element) {
  var elementMetaId, clientIds, i, len, client,
      clients = [];
  if (element && element.nodeType === 1 && (elementMetaId = element.zcClippingId) && _elementMeta.hasOwnProperty(elementMetaId)) {
    clientIds = _elementMeta[elementMetaId];
    if (clientIds && clientIds.length) {
      for (i = 0, len = clientIds.length; i < len; i++) {
        client = _clientMeta[clientIds[i]].instance;
        if (client && client instanceof ZeroClipboard) {
          clients.push(client);
        }
      }
    }
  }
  return clients;
};

_globalConfig.hoverClass = "zeroclipboard-is-hover";


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for alternatives.
 *
 * The CSS class used to indicate that the object is active. Similar to `:active`.
 *
 * Originally from "core.js"
 */
_globalConfig.activeClass = "zeroclipboard-is-active";


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for alternatives.
 *
 * Page origins that the SWF should trust (single string or array of strings)
 *
 * Originally from "core.js"
 */
_globalConfig.trustedOrigins = null;


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for more info.
 *
 * SWF outbound scripting policy
 *
 * Originally from "core.js"
 */
_globalConfig.allowScriptAccess = null;


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for alternatives.
 *
 * Include a "nocache" query parameter on requests for the SWF
 *
 * Originally from "core.js"
 */
_globalConfig.useNoCache = true;


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for alternatives.
 *
 * URL to movie
 *
 * Originally from "core.js"
 */
_globalConfig.moviePath = "ZeroClipboard.swf";


/*
 * @deprecated in [v1.2.0], slated for removal in [v2.0.0]. See docs for more info.
 *
 * Simple Flash Detection
 *
 * returns true if Flash is detected, otherwise false
 *
 * Originally from "core.js", then "flash.js"
 */
ZeroClipboard.detectFlashSupport = function () {
  _deprecationWarning("ZeroClipboard.detectFlashSupport", _globalConfig.debug);
  return _detectFlashSupport();
};


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for alternatives.
 *
 * Bridge from the Flash object back to the JavaScript
 *
 * returns nothing
 *
 * Originally from "event.js"
 */
ZeroClipboard.dispatch = function (eventName, args) {
  if (typeof eventName === "string" && eventName) {
    // Sanitize the event name
    var cleanEventName = eventName.toLowerCase().replace(/^on/, "");

    // Receive event from Flash movie, forward to clients
    if (cleanEventName) {
      // Get an array of clients that have been glued to the `currentElement`, or
      // get ALL clients if no `currentElement` (e.g. for the global Flash events like "load", etc.)
      var clients = (currentElement && _globalConfig.autoActivate === true) ?
                      _getAllClientsClippedToElement(currentElement) :
                      _getAllClients();
      for (var i = 0, len = clients.length; i < len; i++) {
        _receiveEvent.call(clients[i], cleanEventName, args);
      }
    }
  }
};


/*
 * @deprecated in [v1.2.0], slated for removal in [v2.0.0]. See docs for alternatives.
 *
 * Sends a signal to the flash object to display the hand cursor if true.
 * Updates the value of the `forceHandCursor` option.
 *
 * returns object instance
 */
ZeroClipboard.prototype.setHandCursor = function (enabled) {
  _deprecationWarning("ZeroClipboard.prototype.setHandCursor", _globalConfig.debug);
  enabled = typeof enabled === "boolean" ? enabled : !!enabled;
  _setHandCursor(enabled);
  _globalConfig.forceHandCursor = enabled;

  return this;
};


/*
 * @deprecated in [v1.2.0], slated for removal in [v2.0.0]. See docs for more info.
 *
 * Reposition the Flash object to cover the current element being hovered over.
 *
 * returns object instance
 */
ZeroClipboard.prototype.reposition = function () {
  _deprecationWarning("ZeroClipboard.prototype.reposition", _globalConfig.debug);
  return _reposition();
};



/*
 * @deprecated in [v1.2.0], slated for removal in [v2.0.0]. See docs for more info.
 *
 * Receive an event for a specific client, typically from Flash.
 *
 * returns nothing
 */
ZeroClipboard.prototype.receiveEvent = function (eventName, args) {
  _deprecationWarning("ZeroClipboard.prototype.receiveEvent", _globalConfig.debug);
  if (typeof eventName === "string" && eventName) {
    // Sanitize the event name
    var cleanEventName = eventName.toLowerCase().replace(/^on/, "");

    // receive event from Flash movie, send to client
    if (cleanEventName) {
      _receiveEvent.call(this, cleanEventName, args);
    }
  }
};


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for alternatives.
 *
 * Sets the current HTML object that the Flash object should overlay. This will put the global Flash object on top of
 * the current element; depending on the setup, this may also set the pending clipboard text data as well as the Flash
 * object's wrapping element's title attribute based on the underlying HTML element and ZeroClipboard configuration.
 *
 * returns object instance
 */
ZeroClipboard.prototype.setCurrent = function (element) {
  _deprecationWarning("ZeroClipboard.prototype.setCurrent", _globalConfig.debug);
  ZeroClipboard.activate(element);
  return this;
};


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for alternatives.
 *
 * Reset the html bridge to be hidden off screen and not have title or text.
 *
 * returns object instance
 */
ZeroClipboard.prototype.resetBridge = function () {
  _deprecationWarning("ZeroClipboard.prototype.resetBridge", _globalConfig.debug);
  ZeroClipboard.deactivate();
  return this;
};


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for alternatives.
 *
 * Adds a title="..." attribute to the htmlBridge to give it tooltip capabilities
 *
 * returns object instance
 */
ZeroClipboard.prototype.setTitle = function (newTitle) {
  _deprecationWarning("ZeroClipboard.prototype.setTitle", _globalConfig.debug);
  // If the element has a title, mimic it
  newTitle = newTitle || _globalConfig.title || (currentElement && currentElement.getAttribute("title"));
  if (newTitle) {
    var htmlBridge = _getHtmlBridge(flashState.bridge);
    if (htmlBridge) {
      htmlBridge.setAttribute("title", newTitle);
    }
  }

  return this;
};


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for alternatives.
 *
 * Set defaults.
 *
 * returns nothing
 */
ZeroClipboard.setDefaults = function (options) {
  _deprecationWarning("ZeroClipboard.setDefaults", _globalConfig.debug);
  ZeroClipboard.config(options);
};


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for alternatives.
 *
 * An original API method name, now only an alias for `on`.
 *
 * returns object instance
 */
ZeroClipboard.prototype.addEventListener = function (eventName, func) {
  _deprecationWarning("ZeroClipboard.prototype.addEventListener", _globalConfig.debug);
  return this.on(eventName, func);
};


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for alternatives.
 *
 * An original API method name, now only an alias for `off`.
 *
 * returns object instance
 */
ZeroClipboard.prototype.removeEventListener = function (eventName, func) {
  _deprecationWarning("ZeroClipboard.prototype.removeEventListener", _globalConfig.debug);
  return this.off(eventName, func);
};


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0]. See docs for more info.
 *
 * Helper function to determine if the Flash bridge is ready. Gets this info from
 * a per-bridge status tracker.
 *
 * returns true if the Flash bridge is ready
 */
ZeroClipboard.prototype.ready = function () {
  _deprecationWarning("ZeroClipboard.prototype.ready", _globalConfig.debug);
  return flashState.ready === true;
};


/*
 * @deprecated in [v1.3.0], slated for removal in [v2.0.0].
 * @private
 *
 * Receive an event from Flash for a specific element/client.
 *
 * returns object instance
 *
 * Originally from "event.js"
 */
var _receiveEvent = function (eventName, args) {
  eventName = eventName.toLowerCase().replace(/^on/, '');

  var cleanVersion = (args && args.flashVersion && _parseFlashVersion(args.flashVersion)) || null;
  var element = currentElement;
  var performCallbackAsync = true;

  // special behavior for certain events
  switch (eventName) {
    case 'load':
      if (cleanVersion) {
        // If the Flash version is less than 10, throw event.
        if (!_isFlashVersionSupported(cleanVersion)) {
          _receiveEvent.call(this, "onWrongFlash", { flashVersion: cleanVersion });
          return;
        }
        flashState.outdated = false;
        flashState.ready = true;
        flashState.version = cleanVersion;
      }
      break;

    case 'wrongflash':
      if (cleanVersion && !_isFlashVersionSupported(cleanVersion)) {
        flashState.outdated = true;
        flashState.ready = false;
        flashState.version = cleanVersion;
      }
      break;

    // NOTE: This `mouseover` event is coming from Flash, not DOM/JS
    case 'mouseover':
      _addClass(element, _globalConfig.hoverClass);
      break;

    // NOTE: This `mouseout` event is coming from Flash, not DOM/JS
    case 'mouseout':
      if (_globalConfig.autoActivate === true) {
        ZeroClipboard.deactivate();
      }
      break;

    // NOTE: This `mousedown` event is coming from Flash, not DOM/JS
    case 'mousedown':
      _addClass(element, _globalConfig.activeClass);
      break;

    // NOTE: This `mouseup` event is coming from Flash, not DOM/JS
    case 'mouseup':
      _removeClass(element, _globalConfig.activeClass);
      break;

    case 'datarequested':
      if (element) {
        var targetId = element.getAttribute('data-clipboard-target'),
            targetEl = !targetId ? null : document.getElementById(targetId);
        if (targetEl) {
          var textContent = targetEl.value || targetEl.textContent || targetEl.innerText;
          if (textContent) {
            this.setText(textContent);
          }
        }
        else {
          var defaultText = element.getAttribute('data-clipboard-text');
          if (defaultText) {
            this.setText(defaultText);
          }
        }
      }

      // This callback cannot be performed asynchronously as it would prevent the
      // user from being able to call `.setText` successfully before the pending
      // clipboard injection associated with this event fires.
      performCallbackAsync = false;
      break;

    case 'complete':
      _deleteOwnProperties(_clipData);

      // Focus the context back on the trigger element (blur the Flash element)
      if (element && element !== _safeActiveElement() && element.focus) {
        element.focus();
      }
      break;
  } // switch eventName

  var context = element;
  var eventArgs = [this, args];
  return _dispatchClientCallbacks.call(this, eventName, context, eventArgs, performCallbackAsync);
};
// The AMDJS logic branch is evaluated first to avoid potential confusion over
// the CommonJS syntactical sugar offered by AMD.
if (typeof define === "function" && define.amd) {
  // Alternative `define` that requires these special CommonJS "free variable"
  // dependencies. AMD loaders are required to implement this special use case
  // per the AMDJS spec:
  //   https://github.com/amdjs/amdjs-api/wiki/AMD#wiki-define-dependencies

  define(
    ["require", "exports", "module"],
    function(require, exports, module) {
      // Automatically set the `_amdModuleId` value if loading via AMD
      _amdModuleId = (module && module.id) || null;

      return ZeroClipboard;
    });
}
else if (typeof module === "object" && module && typeof module.exports === "object" && module.exports && typeof window.require === "function") {
  // CommonJS module loaders are required to provide an `id` property on the
  // `module` object that can be used to uniquely load this module again,
  // i.e. `require(module.id)`. This requirement is per the CommonJS modules
  // spec: "Module Context", 3.1.
  //   http://wiki.commonjs.org/articles/m/o/d/Modules_1.1.1_5572.html#Module_Context
  //
  // ZeroClipboard also needs to be able access itself via a globally available `require`.

  // Automatically set the `_cjdModuleId` value if loading via CommonJS
  _cjsModuleId = module.id || null;

  module.exports = ZeroClipboard;
}
else {
  window.ZeroClipboard = ZeroClipboard;
}

})((function() { return this; })());
