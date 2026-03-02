/**
 * 微信小游戏 DOM 适配器
 * 模拟浏览器 DOM/BOM 环境，使 PixiJS 能在微信小游戏中正常运行
 * 
 * 策略：不替换微信已有的 window/document 等全局对象，
 *       而是在它们上面补充 PixiJS 所需的缺失属性。
 */

const _winInfo = wx.getWindowInfo()
const _devInfo = wx.getDeviceInfo()

// ===== 获取微信已有的全局对象 =====
// 微信小游戏环境 GameGlobal 上已有 window/document 等属性且不可重定义
const _global = typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : {})
const _window = (typeof window !== 'undefined') ? window : _global
const _document = (typeof document !== 'undefined') ? document : (_window.document || {})

// ===== 基础 shim 类 =====

// Image → wx.createImage
// 关键：需要让 instanceof HTMLImageElement 对微信原生 Image 也返回 true
// 因为 PixiJS 的 ImageResource.test() 用 instanceof 检测
const _wxImageProto = (() => {
  try {
    const img = wx.createImage()
    return Object.getPrototypeOf(img)
  } catch(e) { return null }
})()

class WxImage {
  constructor() {
    const img = wx.createImage()
    this._img = img
    Object.defineProperty(this, 'src', {
      get() { return img.src },
      set(v) { img.src = v },
    })
    Object.defineProperty(this, 'width', { get() { return img.width } })
    Object.defineProperty(this, 'height', { get() { return img.height } })
    Object.defineProperty(this, 'onload', {
      get() { return img.onload },
      set(v) { img.onload = v },
    })
    Object.defineProperty(this, 'onerror', {
      get() { return img.onerror },
      set(v) { img.onerror = v },
    })
    Object.defineProperty(this, 'complete', {
      get() { return img.width > 0 },
    })
  }

  // 让微信原生 Image 对象也能通过 instanceof WxImage 检查
  static [Symbol.hasInstance](instance) {
    if (instance instanceof Object && instance.constructor === WxImage) return true
    // 检查是否是微信原生 Image（有 src/onload 属性）
    if (instance && typeof instance === 'object' &&
        'src' in instance && 'onload' in instance &&
        _wxImageProto && Object.getPrototypeOf(instance) === _wxImageProto) {
      return true
    }
    return false
  }
}

// HTMLCanvasElement shim
// 关键：需要让 instanceof HTMLCanvasElement 对微信原生 canvas 也返回 true
// 因为 PixiJS 的 CanvasResource.test() 用 instanceof 检测
const _wxCanvasProto = (() => {
  try {
    const c = wx.createCanvas()
    return Object.getPrototypeOf(c)
  } catch(e) { return null }
})()

class WxHTMLCanvasElement {
  constructor(canvas) {
    this._canvas = canvas || wx.createCanvas()
  }
  get width() { return this._canvas.width }
  set width(v) { this._canvas.width = v }
  get height() { return this._canvas.height }
  set height(v) { this._canvas.height = v }
  getContext(type, attrs) { return this._canvas.getContext(type, attrs) }
  addEventListener(type, fn) {
    if (this._canvas.addEventListener) this._canvas.addEventListener(type, fn)
  }
  removeEventListener(type, fn) {
    if (this._canvas.removeEventListener) this._canvas.removeEventListener(type, fn)
  }
  getBoundingClientRect() {
    return {
      top: 0, left: 0,
      width: this._canvas.width / (_winInfo.pixelRatio || 2),
      height: this._canvas.height / (_winInfo.pixelRatio || 2),
      x: 0, y: 0,
    }
  }
  get style() {
    return this._style || (this._style = { width: '', height: '', cursor: '' })
  }
  get parentNode() { return null }
  get nodeName() { return 'CANVAS' }
  get tagName() { return 'CANVAS' }

  // 让微信原生 canvas 对象也能通过 instanceof WxHTMLCanvasElement 检查
  static [Symbol.hasInstance](instance) {
    if (instance instanceof Object && instance.constructor === WxHTMLCanvasElement) return true
    // 检查是否是微信原生 canvas（有 getContext 和 width/height 属性）
    if (instance && typeof instance === 'object' &&
        typeof instance.getContext === 'function' &&
        'width' in instance && 'height' in instance) {
      // 优先用 prototype 精确匹配
      if (_wxCanvasProto && Object.getPrototypeOf(instance) === _wxCanvasProto) return true
      // 后备：如果有 getContext 且不是 WxHTMLCanvasElement 包装器，且有 canvas 特征属性
      if (typeof instance.toDataURL === 'function' || typeof instance.toTempFilePath === 'function') return true
    }
    return false
  }
}

// HTMLElement stub
class WxHTMLElement {
  constructor() { this.childNodes = [] }
  appendChild(child) { this.childNodes.push(child); return child }
  removeChild(child) {
    const idx = this.childNodes.indexOf(child)
    if (idx >= 0) this.childNodes.splice(idx, 1)
    return child
  }
  insertBefore(node) { this.childNodes.push(node); return node }
  get style() {
    return this._style || (this._style = {})
  }
  setAttribute() {}
  getAttribute() { return null }
}

// XMLHttpRequest stub
class WxXMLHttpRequest {
  constructor() {
    this.readyState = 0
    this.status = 0
    this.responseType = ''
    this.response = null
    this.responseText = ''
    this._headers = {}
    this._method = 'GET'
    this._url = ''
  }
  open(method, url) { this._method = method; this._url = url }
  setRequestHeader(k, v) { this._headers[k] = v }
  send(body) {
    const self = this
    wx.request({
      url: this._url,
      method: this._method,
      header: this._headers,
      data: body,
      dataType: this.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
      responseType: this.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
      success(res) {
        self.status = res.statusCode
        self.readyState = 4
        self.response = res.data
        self.responseText = typeof res.data === 'string' ? res.data : ''
        if (self.onload) self.onload()
        if (self.onreadystatechange) self.onreadystatechange()
      },
      fail(err) {
        self.status = 0
        self.readyState = 4
        if (self.onerror) self.onerror(err)
      },
    })
  }
  abort() {}
}

// Event stub
class WxEvent {
  constructor(type) {
    this.type = type
    this.target = null
    this.currentTarget = null
    this.bubbles = false
    this.cancelable = false
    this.defaultPrevented = false
    this.timeStamp = Date.now()
  }
  preventDefault() { this.defaultPrevented = true }
  stopPropagation() {}
}

// TouchEvent
class WxTouchEvent extends WxEvent {
  constructor(type) {
    super(type)
    this.touches = []
    this.changedTouches = []
    this.targetTouches = []
  }
}

// ===== 安全属性补充工具 =====
// 只在目标对象上补充不存在的属性，不尝试覆盖已有属性
function _patchIfMissing(target, key, value) {
  if (target == null) return
  if (key in target) return // 已存在则不覆盖
  try {
    Object.defineProperty(target, key, {
      configurable: true,
      writable: true,
      enumerable: true,
      value: value,
    })
  } catch (e) {
    try { target[key] = value } catch (e2) { /* ignore */ }
  }
}

// ===== 补充 document 缺失属性 =====
const _body = new WxHTMLElement()

// PixiJS 关键：document.baseURI 必须是字符串，否则 getBaseUrl 会返回 location 对象
_patchIfMissing(_document, 'baseURI', '')
_patchIfMissing(_document, 'body', _body)
_patchIfMissing(_document, 'documentElement', _body)
_patchIfMissing(_document, 'createElement', function(tag) {
  if (tag === 'canvas') return new WxHTMLCanvasElement()
  if (tag === 'img') return new WxImage()
  return new WxHTMLElement()
})
_patchIfMissing(_document, 'createElementNS', function(ns, tag) {
  return _document.createElement(tag)
})
_patchIfMissing(_document, 'getElementById', function() { return null })
_patchIfMissing(_document, 'getElementsByTagName', function(tag) {
  if (tag === 'head' || tag === 'body') return [_body]
  return []
})
_patchIfMissing(_document, 'querySelector', function() { return null })
_patchIfMissing(_document, 'querySelectorAll', function() { return [] })
_patchIfMissing(_document, 'addEventListener', function() {})
_patchIfMissing(_document, 'removeEventListener', function() {})
_patchIfMissing(_document, 'createEvent', function(type) { return new WxEvent(type) })
_patchIfMissing(_document, 'hidden', false)
_patchIfMissing(_document, 'visibilityState', 'visible')
// fonts 接口 (PixiJS HTMLText 用)
_patchIfMissing(_document, 'fonts', { add() {}, delete() {}, has() { return false }, forEach() {} })

// ===== 补充 window 缺失属性 =====
const _raf = typeof requestAnimationFrame !== 'undefined'
  ? requestAnimationFrame
  : (fn) => setTimeout(fn, 16)
const _craf = typeof cancelAnimationFrame !== 'undefined'
  ? cancelAnimationFrame
  : clearTimeout

_patchIfMissing(_window, 'innerWidth', _winInfo.windowWidth)
_patchIfMissing(_window, 'innerHeight', _winInfo.windowHeight)
_patchIfMissing(_window, 'devicePixelRatio', _winInfo.pixelRatio || 2)
_patchIfMissing(_window, 'requestAnimationFrame', _raf)
_patchIfMissing(_window, 'cancelAnimationFrame', _craf)
_patchIfMissing(_window, 'Image', WxImage)
// 强制覆盖关键类
try { _window.HTMLImageElement = WxImage } catch(e) {}
try { _window.HTMLCanvasElement = WxHTMLCanvasElement } catch(e) {}
_patchIfMissing(_window, 'HTMLElement', WxHTMLElement)
_patchIfMissing(_window, 'TouchEvent', WxTouchEvent)
_patchIfMissing(_window, 'Event', WxEvent)
_patchIfMissing(_window, 'XMLHttpRequest', WxXMLHttpRequest)
_patchIfMissing(_window, 'addEventListener', function() {})
_patchIfMissing(_window, 'removeEventListener', function() {})
_patchIfMissing(_window, 'getComputedStyle', function() { return {} })

_patchIfMissing(_window, 'navigator', {
  userAgent: 'wechat-minigame',
  platform: _devInfo.platform || 'WeChat',
  language: 'zh-CN',
  appVersion: '',
  maxTouchPoints: 10,
})

// 关键修复：确保 location.href 是字符串而不是对象
// PixiJS 的 getBaseUrl 会 fallback 到 window.location.href
if (_window.location) {
  // location 已存在，确保 href 是字符串
  if (typeof _window.location.href !== 'string') {
    try { _window.location.href = '' } catch(e) { /* readonly */ }
  }
  _patchIfMissing(_window.location, 'protocol', 'https:')
  _patchIfMissing(_window.location, 'hostname', 'localhost')
  _patchIfMissing(_window.location, 'href', '')
} else {
  _patchIfMissing(_window, 'location', { href: '', protocol: 'https:', hostname: 'localhost' })
}

_patchIfMissing(_window, 'performance', typeof performance !== 'undefined' ? performance : {
  now: () => Date.now(),
})
_patchIfMissing(_window, 'document', _document)
_patchIfMissing(_window, 'screen', {
  width: _winInfo.windowWidth,
  height: _winInfo.windowHeight,
  availWidth: _winInfo.windowWidth,
  availHeight: _winInfo.windowHeight,
})

// ===== 补充 GameGlobal 上的构造函数 =====
// 关键：HTMLCanvasElement 和 HTMLImageElement 必须强制设为我们的 shim 类
// 因为 PixiJS 的 CanvasResource.test / ImageResource.test 用 instanceof 检测
// 我们的 shim 类有 Symbol.hasInstance 可以识别微信原生对象
if (typeof GameGlobal !== 'undefined') {
  _patchIfMissing(GameGlobal, 'Image', WxImage)
  // 强制覆盖这些关键类（PixiJS instanceof 检测依赖它们）
  try { GameGlobal.HTMLCanvasElement = WxHTMLCanvasElement } catch(e) {}
  try { GameGlobal.HTMLImageElement = WxImage } catch(e) {}
  _patchIfMissing(GameGlobal, 'HTMLElement', WxHTMLElement)
  _patchIfMissing(GameGlobal, 'TouchEvent', WxTouchEvent)
  _patchIfMissing(GameGlobal, 'Event', WxEvent)
  _patchIfMissing(GameGlobal, 'XMLHttpRequest', WxXMLHttpRequest)
  _patchIfMissing(GameGlobal, 'HTMLVideoElement', class HTMLVideoElement {})
  _patchIfMissing(GameGlobal, 'self', _window)
  if (typeof WebGLRenderingContext === 'undefined') {
    _patchIfMissing(GameGlobal, 'WebGLRenderingContext', function() {})
  }
}

// ===== 补充 globalThis =====
if (typeof globalThis !== 'undefined') {
  _patchIfMissing(globalThis, 'Image', WxImage)
  // 强制覆盖这些关键类
  try { globalThis.HTMLCanvasElement = WxHTMLCanvasElement } catch(e) {}
  try { globalThis.HTMLImageElement = WxImage } catch(e) {}
  _patchIfMissing(globalThis, 'HTMLElement', WxHTMLElement)
  _patchIfMissing(globalThis, 'XMLHttpRequest', WxXMLHttpRequest)
  _patchIfMissing(globalThis, 'self', _window)
  if (typeof WebGLRenderingContext === 'undefined') {
    _patchIfMissing(globalThis, 'WebGLRenderingContext', function() {})
  }
}

// ===== 关键修复：覆盖 PixiJS 的 BrowserAdapter =====
// PixiJS 内部的 ADAPTER.getBaseUrl 默认返回 document.baseURI ?? window.location.href
// 在微信小游戏中这两者可能返回对象而非字符串，导致路径拼接成 [object Object]
// 我们在 PixiJS 加载后通过 PIXI.settings.ADAPTER 覆盖

console.log('[wx-adapter] DOM 适配层已加载')

module.exports = {
  window: _window,
  document: _document,
  Image: WxImage,
  HTMLCanvasElement: WxHTMLCanvasElement,
  HTMLElement: WxHTMLElement,
  TouchEvent: WxTouchEvent,
  Event: WxEvent,
  XMLHttpRequest: WxXMLHttpRequest,
  dpr: _winInfo.pixelRatio || 2,
  screenWidth: _winInfo.windowWidth,
  screenHeight: _winInfo.windowHeight,
}
