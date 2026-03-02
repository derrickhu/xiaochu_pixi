/**
 * 渲染环境共享对象
 * 所有 view 模块通过 init() 获取画布上下文和常量引用
 * 
 * 架构：PixiJS 原生渲染 + Canvas 2D 辅助（measureText等）
 * - pixi: PixiJS 引用（app, stage, renderer, PIXI, SceneManager, AssetManager, PR）
 * - ctx: 离屏Canvas 2D上下文（仅用于measureText等辅助，不再直接渲染到屏幕）
 * - R: 原有Render实例（逐步废弃，过渡期间部分场景仍使用）
 */
let _ctx, _R, _TH, _W, _H, _S, _safeTop, _COLS, _ROWS
let _pixi = null  // { app, stage, renderer, PIXI, scenes, assets, PR }

function init(ctx, R, TH, W, H, S, safeTop, COLS, ROWS) {
  _ctx = ctx; _R = R; _TH = TH
  _W = W; _H = H; _S = S; _safeTop = safeTop
  _COLS = COLS; _ROWS = ROWS
}

/**
 * 设置 PixiJS 引用（main.js 初始化后调用）
 */
function setPixi(pixiRefs) {
  _pixi = pixiRefs
}

module.exports = {
  init,
  setPixi,
  get ctx() { return _ctx },
  get R() { return _R },
  get TH() { return _TH },
  get W() { return _W },
  get H() { return _H },
  get S() { return _S },
  get safeTop() { return _safeTop },
  get COLS() { return _COLS },
  get ROWS() { return _ROWS },
  get pixi() { return _pixi },
}
