/**
 * PixiJS 版渲染环境共享对象
 * 替代原 views/env.js 的 Canvas 2D ctx
 * 
 * 所有 view 模块通过此对象获取 PIXI app、stage 和常量引用
 */
const PIXI = require('../libs/pixi-wrapper')

let _app = null      // PIXI.Application
let _stage = null     // app.stage (根容器)
let _R = null         // Render 实例
let _W = 0, _H = 0   // Canvas 像素宽高
let _S = 1            // 缩放因子 (W / 375)
let _safeTop = 0      // 安全区域顶部（像素）
let _COLS = 6, _ROWS = 5
let _dpr = 2

// 主题色常量（保持与原 TH 一致）
const TH = {
  bg: '#0b0b15',
  card: 'rgba(22,22,38,0.92)',
  cardB: 'rgba(60,60,90,0.3)',
  text: '#eeeeee',
  sub: 'rgba(200,200,210,0.7)',
  dim: 'rgba(140,140,160,0.5)',
  accent: '#ffd700',
  danger: '#ff4d6a',
  success: '#4dcc4d',
  info: '#4dabff',
  hard: '#ff8c00',
  extreme: '#ff4d6a',
}

// 主题色转整数（PixiJS用）
const TH_INT = {
  bg: 0x0b0b15,
  card: 0x161626,
  accent: 0xffd700,
  danger: 0xff4d6a,
  success: 0x4dcc4d,
  info: 0x4dabff,
  hard: 0xff8c00,
  text: 0xeeeeee,
}

/**
 * 初始化 PixiJS 渲染环境
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas - 微信小游戏主Canvas
 * @param {number} opts.width - Canvas像素宽
 * @param {number} opts.height - Canvas像素高
 * @param {number} opts.dpr - 设备像素比
 * @param {number} opts.safeTop - 安全区顶部像素值
 */
function init(opts) {
  _W = opts.width
  _H = opts.height
  _dpr = opts.dpr || 2
  _S = _W / 375
  _safeTop = opts.safeTop || 0

  const mainCanvas = opts.canvas

  // ===== 关键修复：跳过 isWebGLSupported 检测 =====
  // PixiJS 的 isWebGLSupported() 会通过 ADAPTER.createCanvas() 创建临时 canvas
  // 然后在上面调 getContext('webgl') 测试，测完后把 canvas 尺寸设为 0x0 释放资源。
  // 之前的方案让 createCanvas 首次返回主 canvas，导致主 canvas 的 drawingBuffer 被设为 0x0。
  // 修复：直接 monkey-patch isWebGLSupported 返回 true，跳过检测。
  if (PIXI.utils) {
    PIXI.utils.isWebGLSupported = function() { return true }
  }

  // ADAPTER.createCanvas 始终返回离屏 canvas（不再劫持主 canvas）
  PIXI.settings.ADAPTER.createCanvas = function(w, h) {
    const c = wx.createCanvas()
    if (w) c.width = w
    if (h) c.height = h
    return c
  }

  // 确保 getWebGLRenderingContext 返回值
  if (!PIXI.settings.ADAPTER.getWebGLRenderingContext) {
    PIXI.settings.ADAPTER.getWebGLRenderingContext = function() {
      return (typeof WebGLRenderingContext !== 'undefined') ? WebGLRenderingContext : true
    }
  }

  // BatchRenderer 修复：微信小游戏 WebGL 环境下 gl.createShader 可能返回 null
  // 完全重写 contextChange，跳过 checkMaxIfStatementsInShader
  if (PIXI.BatchRenderer) {
    PIXI.BatchRenderer.defaultMaxTextures = 4
    PIXI.BatchRenderer.prototype.contextChange = function() {
      const gl = this.renderer.gl
      let maxTex = 4
      try {
        const val = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)
        if (val && val > 0) {
          maxTex = Math.min(val, PIXI.BatchRenderer.defaultMaxTextures)
        }
      } catch(e) {
        console.warn('[ViewEnv] gl.getParameter failed:', e.message)
      }
      this.maxTextures = maxTex
      this._shader = this.shaderGenerator.generateShader(this.maxTextures)
      for (let i = 0; i < this._packedGeometryPoolSize; i++) {
        this._packedGeometries[i] = new this.geometryClass()
      }
      this.initFlushBuffers()
    }
  }

  // 创建 PIXI Application（直接传入主 canvas，由 PixiJS 在上面 getContext('webgl')）
  // 禁用 PixiJS 内置事件系统：我们用手动 _hitRect 检测触摸，
  // PixiJS EventSystem 会在 canvas 上抢注 touch/pointer 事件，导致微信小游戏中触摸失灵
  _app = new PIXI.Application({
    view: mainCanvas,
    width: _W,
    height: _H,
    backgroundColor: 0x0b0b15,
    resolution: 1,
    autoDensity: false,
    antialias: true,
    clearBeforeRender: true,
    powerPreference: 'high-performance',
    eventMode: 'none',
    eventFeatures: {
      move: false,
      globalMove: false,
      click: false,
      wheel: false,
    },
  })

  // 强制销毁 PixiJS 内置 EventSystem（防止 eventFeatures 在某些版本不生效）
  // 我们不使用 PixiJS 的 FederatedEvent，所有交互通过手动 _hitRect 处理
  if (_app.renderer.events) {
    try {
      _app.renderer.events.destroy()
      console.log('[ViewEnv] PixiJS EventSystem 已销毁，使用手动触摸处理')
    } catch(e) {
      console.warn('[ViewEnv] EventSystem 销毁失败:', e.message)
    }
  }

  _stage = _app.stage
  _stage.sortableChildren = true
  _stage.eventMode = 'none'

  console.log(`[ViewEnv] PixiJS 初始化完成: ${_W}x${_H}, S=${_S.toFixed(2)}, renderer=${_app.renderer.type}(1=WebGL)`)

  return _app
}

/**
 * 设置 Render 实例引用
 */
function setRender(r) {
  _R = r
}

module.exports = {
  init,
  setRender,
  TH,
  TH_INT,
  PIXI,
  get app() { return _app },
  get stage() { return _stage },
  get renderer() { return _app ? _app.renderer : null },
  get R() { return _R },
  get W() { return _W },
  get H() { return _H },
  get S() { return _S },
  get dpr() { return _dpr },
  get safeTop() { return _safeTop },
  get COLS() { return _COLS },
  get ROWS() { return _ROWS },
}
