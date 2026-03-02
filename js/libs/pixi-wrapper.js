/**
 * PixiJS 微信小游戏包装器
 * 确保全局DOM适配层就绪后加载PixiJS
 */

// 1. 先加载DOM适配器（设置全局 window/document/Image 等）
require('../platform/wx-adapter')

// 2. 加载 PixiJS（已在末尾添加 module.exports = PIXI）
const PIXI = require('./pixi.min')

// 3. 关键：加载 unsafe-eval 补丁，替换 ShaderSystem 中的 new Function()
//    微信小游戏禁止 eval/new Function，必须在创建 Application 之前安装
if (PIXI) {
  // pixi-unsafe-eval.js 是 IIFE，会自动从全局获取 PIXI 并安装
  // 但我们需要先确保 PIXI 在全局可访问
  if (typeof GameGlobal !== 'undefined') GameGlobal.PIXI = PIXI
  if (typeof globalThis !== 'undefined') globalThis.PIXI = PIXI
  require('./pixi-unsafe-eval')
}

if (!PIXI) {
  console.error('[PixiJS] 加载失败')
} else {
  console.log('[PixiJS] v' + PIXI.VERSION + ' 加载成功')
  
  // 关键修复：覆盖 PixiJS 的 BrowserAdapter
  // 默认的 getBaseUrl 返回 document.baseURI ?? window.location.href
  // 在微信小游戏中，这些可能是对象而非字符串，导致路径变成 [object Object]
  if (PIXI.settings && PIXI.settings.ADAPTER) {
    const origAdapter = PIXI.settings.ADAPTER
    PIXI.settings.ADAPTER = Object.assign({}, origAdapter, {
      getBaseUrl: function() {
        // 始终返回空字符串，微信小游戏中用相对路径加载资源
        return ''
      },
      getNavigator: function() {
        return typeof navigator !== 'undefined' ? navigator : {
          userAgent: 'wechat-minigame',
          platform: 'WeChat',
          maxTouchPoints: 10,
        }
      },
      getFontFaceSet: function() {
        // 微信小游戏不支持 FontFaceSet
        return { add() {}, delete() {}, has() { return false }, forEach() {} }
      },
      fetch: function(url, opts) {
        // 微信小游戏不支持 fetch，返回 rejected promise
        return Promise.reject(new Error('[wx-adapter] fetch not supported in WeChat MiniGame'))
      },
      createCanvas: function(w, h) {
        const c = wx.createCanvas()
        if (w) c.width = w
        if (h) c.height = h
        return c
      },
      getCanvasRenderingContext2D: function() {
        return CanvasRenderingContext2D
      },
      getWebGLRenderingContext: function() {
        return typeof WebGLRenderingContext !== 'undefined' ? WebGLRenderingContext : null
      },
    })
    console.log('[PixiJS] ADAPTER 已覆盖为微信小游戏适配版本')
  }
}

module.exports = PIXI
