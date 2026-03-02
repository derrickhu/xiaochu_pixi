// ===== 0. 日志劫持：同时写入文件，方便调试 =====
;(function() {
  const fs = wx.getFileSystemManager()
  const LOG_FILE = `${wx.env.USER_DATA_PATH}/debug_log.txt`
  // 清空旧日志
  try { fs.writeFileSync(LOG_FILE, '', 'utf8') } catch(e) {}

  function appendLog(level, args) {
    try {
      const ts = new Date().toTimeString().slice(0, 8)
      const msg = `[${ts}][${level}] ` + Array.from(args).map(a => {
        if (a === null) return 'null'
        if (a === undefined) return 'undefined'
        if (a instanceof Error) return a.message + '\n' + (a.stack || '')
        if (typeof a === 'object') {
          try { return JSON.stringify(a).slice(0, 500) } catch(e) { return String(a) }
        }
        return String(a)
      }).join(' ') + '\n'
      fs.appendFileSync(LOG_FILE, msg, 'utf8')
    } catch(e) { /* 写入失败静默 */ }
  }

  const _log = console.log, _warn = console.warn, _error = console.error, _info = console.info
  console.log = function() { _log.apply(console, arguments); appendLog('LOG', arguments) }
  console.warn = function() { _warn.apply(console, arguments); appendLog('WARN', arguments) }
  console.error = function() { _error.apply(console, arguments); appendLog('ERR', arguments) }
  console.info = function() { _info.apply(console, arguments); appendLog('INFO', arguments) }

  // 全局暴露，方便随时读取
  GameGlobal.__LOG_FILE = LOG_FILE
  GameGlobal.__readLog = function() { try { return fs.readFileSync(LOG_FILE, 'utf8') } catch(e) { return 'read fail: ' + e.message } }
})();

console.log('灵宠消消塔 PixiJS 版开始初始化...')

// ===== 1. 创建主Canvas（必须最先！） =====
// 微信小游戏中第一个 wx.createCanvas() 返回的是主屏 canvas
// 后续创建的都是离屏 canvas
// 所以必须在 require wx-adapter 之前创建，因为 wx-adapter 内部也会调 wx.createCanvas()
const _canvas = wx.createCanvas()
GameGlobal.__mainCanvas = _canvas

const _winInfo = wx.getWindowInfo()
const _dpr = _winInfo.pixelRatio || 2
_canvas.width = _winInfo.windowWidth * _dpr
_canvas.height = _winInfo.windowHeight * _dpr

// ===== 2. 加载DOM适配器 =====
require('./js/platform/wx-adapter')

// ===== 3. 显示原生加载提示 =====
// 不在主Canvas上绘制loading画面，因为那会获取2d上下文导致WebGL不可用
wx.showLoading({ title: '加载中...', mask: true })

// ===== 4. 分包加载 =====
let assetsLoaded = false
let audioLoaded = false

function tryStartGame() {
  if (!assetsLoaded || !audioLoaded) return
  console.log('[SubPkg] 分包全部加载完成，启动游戏')
  wx.hideLoading()
  try {
    require('./js/main')
    console.log('游戏初始化成功（PixiJS模式）')
  } catch (e) {
    console.error('游戏初始化失败:', e)
    // 错误画面：PixiJS失败时用离屏Canvas绘制错误信息
    const errCanvas = wx.createCanvas()
    errCanvas.width = _canvas.width; errCanvas.height = _canvas.height
    const ctx = errCanvas.getContext('2d')
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, errCanvas.width, errCanvas.height)
    ctx.fillStyle = '#f00'; ctx.font = '16px sans-serif'
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillText('游戏初始化失败', 20, 20)
    ctx.fillText(e.message, 20, 50)
    ctx.fillText(e.stack?.substring(0, 200), 20, 80)
    wx.showModal({ title: '初始化失败', content: e.message, showCancel: false })
  }
}

wx.loadSubpackage({
  name: 'assets',
  success: () => {
    console.log('[SubPkg] assets 分包加载成功')
    assetsLoaded = true
    tryStartGame()
  },
  fail: (err) => {
    console.error('[SubPkg] assets 分包加载失败:', err)
    assetsLoaded = true
    tryStartGame()
  }
})

wx.loadSubpackage({
  name: 'audio',
  success: () => {
    console.log('[SubPkg] audio 分包加载成功')
    audioLoaded = true
    tryStartGame()
  },
  fail: (err) => {
    console.error('[SubPkg] audio 分包加载失败:', err)
    audioLoaded = true
    tryStartGame()
  }
})
