/**
 * 灵宠消消塔 - 主游戏逻辑（PixiJS 原生渲染版）
 * Roguelike爬塔 + 智龙迷城式拖拽转珠 + 五行克制
 * 
 * 架构：
 * - PixiJS Application 接管主Canvas WebGL渲染
 * - 所有场景使用原生PixiJS Scene Graph（PIXI.Container / Graphics / Sprite / Text）
 * - 每个场景有 build() 构建对象 + update() 每帧更新属性
 * - 辅助离屏Canvas 2D仅用于measureText
 * - ticker驱动渲染循环，替代requestAnimationFrame
 */

// ===== PixiJS 基础设施 =====
const PIXI = require('./libs/pixi-wrapper')
const PixiEnv = require('./pixi/ViewEnv')
const SceneManager = require('./pixi/SceneManager')
const AssetManager = require('./pixi/AssetManager')
const PR = require('./pixi/PixiRender')
const { createPrepareBuilder } = require('./pixi/prepareScene')
const { createOverlayRenderer } = require('./pixi/globalOverlays')

// ===== 原有模块（保持不变） =====
const { Render, TH } = require('./render')
const Storage = require('./data/storage')
const { ATTR_COLOR, generateRewards, MAX_FLOOR } = require('./data/tower')
const { getMaxedPetIds } = require('./data/pets')
const MusicMgr = require('./runtime/music')
const ViewEnv = require('./views/env')
const screens = require('./views/screens')
const prepareView = require('./views/prepareView')
const eventView = require('./views/eventView')
const battleView = require('./views/battleView')
const dialogs = require('./views/dialogs')
const touchH = require('./input/touchHandlers')
const battleEngine = require('./engine/battle')
const skillEngine = require('./engine/skills')
const anim = require('./engine/animations')
const runMgr = require('./engine/runManager')
const tutorial = require('./engine/tutorial')

// ===== Canvas和环境初始化 =====
const canvas = GameGlobal.__mainCanvas || wx.createCanvas()
const _winInfo = wx.getWindowInfo()
const _devInfo = wx.getDeviceInfo()
const dpr = _winInfo.pixelRatio || 2
canvas.width = _winInfo.windowWidth * dpr
canvas.height = _winInfo.windowHeight * dpr
const W = canvas.width, H = canvas.height
const S = W / 375
console.log(`[Canvas] ${W}x${H}, dpr=${dpr}, S=${S.toFixed(2)}, platform=${_devInfo.platform}`)
const safeTop = (_winInfo.safeArea?.top || 20) * dpr

// 给微信原生Canvas补充PixiJS需要的DOM属性
// 用 try/catch 包裹每个赋值，因为微信原生 canvas 某些属性是只读 getter
function _safePatch(obj, key, val) {
  try {
    if (!(key in obj)) obj[key] = val
  } catch(e) {
    try {
      Object.defineProperty(obj, key, { configurable: true, writable: true, value: val })
    } catch(e2) { /* 无法覆盖只读属性，跳过 */ }
  }
}
_safePatch(canvas, 'style', { width: '', height: '', cursor: '' })
_safePatch(canvas, 'parentNode', null)
_safePatch(canvas, 'nodeName', 'CANVAS')
_safePatch(canvas, 'tagName', 'CANVAS')
if (!canvas.getBoundingClientRect) {
  canvas.getBoundingClientRect = () => ({
    top: 0, left: 0, x: 0, y: 0,
    width: canvas.width / dpr, height: canvas.height / dpr,
  })
}

const COLS = 6, ROWS = 5

// ===== 初始化 PixiJS =====
let pixiApp = null
let pixiReady = false

try {
  pixiApp = PixiEnv.init({
    canvas, width: W, height: H, dpr, safeTop,
  })
  SceneManager.init()
  pixiReady = true
  console.log('[Main] PixiJS + SceneManager 初始化成功')
} catch (e) {
  console.error('[Main] PixiJS 初始化失败，降级到Canvas 2D:', e.message, e.stack)
  pixiReady = false
}

// ===== 辅助离屏Canvas 2D（仅用于measureText等） =====
let auxCanvas = wx.createCanvas()
auxCanvas.width = 10
auxCanvas.height = 10
let auxCtx = auxCanvas.getContext('2d')

// 如果PixiJS失败，降级到Canvas 2D直接渲染
let fallbackCtx = null
if (!pixiReady) {
  fallbackCtx = canvas.getContext('2d')
  if (!fallbackCtx) {
    let fb = wx.createCanvas()
    fb.width = W; fb.height = H
    fallbackCtx = fb.getContext('2d')
  }
}

// ===== Render实例（过渡期间仍需要，用于颜色工具和图片加载） =====
// 如果PixiJS就绪，ctx传辅助画布；否则传降级画布
const ctx = pixiReady ? auxCtx : fallbackCtx
const R = new Render(ctx, W, H, S, safeTop)

// ===== ViewEnv 初始化（让现有view模块能访问渲染环境） =====
ViewEnv.init(ctx, R, TH, W, H, S, safeTop, COLS, ROWS)
if (pixiReady) {
  ViewEnv.setPixi({
    app: pixiApp,
    stage: PixiEnv.stage,
    renderer: PixiEnv.renderer,
    PIXI, PR,
    scenes: SceneManager,
    assets: AssetManager,
    env: PixiEnv,
  })
}

// ===== PixiJS 场景构建器注册 =====
// 每个场景有：build(game) 创建/重建对象, update(game) 每帧更新
const sceneBuilders = {}

/**
 * 注册场景构建器
 */
function registerScene(name, builder) {
  sceneBuilders[name] = builder
}

// ===== Loading 场景（PixiJS原生）=====
registerScene('loading', {
  _built: false,
  _objects: {},

  build(g) {
    const scene = SceneManager.getScene('loading')
    if (!scene) return
    scene.removeChildren()

    // 背景：先用纯色，等图片加载后替换
    const bg = new PIXI.Graphics()
    bg.beginFill(0x050510)
    bg.drawRect(0, 0, W, H)
    bg.endFill()
    scene.addChild(bg)

    // 背景图片
    const bgSprite = PR.createCoverSprite('assets/backgrounds/loading_bg.jpg', W, H)
    scene.addChild(bgSprite)

    // 进度条底槽
    const barW = W * 0.6
    const barH = 10 * S
    const barX = (W - barW) / 2
    const barY = H - 60 * S
    const radius = barH / 2

    const barBg = new PIXI.Graphics()
    barBg.beginFill(0xffffff, 0.3)
    barBg.drawRoundedRect(barX, barY, barW, barH, radius)
    barBg.endFill()
    scene.addChild(barBg)

    // 进度条填充
    const barFill = new PIXI.Graphics()
    scene.addChild(barFill)

    // 百分比文字
    const pctText = PR.createText('0%', {
      fontSize: 11 * S,
      fill: '#ffd700',
      fontWeight: 'bold',
      anchor: { x: 1, y: 0.5 },
      stroke: '#000000',
      strokeThickness: 3 * S,
    })
    pctText.position.set(barX + barW, barY - 10 * S)
    scene.addChild(pctText)

    this._objects = { barFill, pctText, barX, barY, barW, barH, radius }
    this._built = true
  },

  update(g) {
    if (!this._built) this.build(g)
    const { barFill, pctText, barX, barY, barW, barH, radius } = this._objects
    const pct = g._loadPct || 0

    // 更新进度条
    barFill.clear()
    if (pct > 0) {
      const fillW = Math.max(barH, barW * pct)
      // 金色填充
      barFill.beginFill(0xffd700)
      barFill.drawRoundedRect(barX, barY, fillW, barH, radius)
      barFill.endFill()
      // 高光
      barFill.beginFill(0xffffff, 0.35)
      barFill.drawRoundedRect(barX, barY, fillW, barH * 0.45, radius)
      barFill.endFill()
    }

    // 更新百分比文字
    const newText = `${Math.round(pct * 100)}%`
    if (pctText.text !== newText) {
      pctText.text = newText
    }
  },
})

// ===== Title 场景（PixiJS原生）=====
registerScene('title', {
  _built: false,
  _objects: {},
  _lastState: '',

  build(g) {
    const scene = SceneManager.getScene('title')
    if (!scene) return
    scene.removeChildren()

    // 背景
    const bg = new PIXI.Graphics()
    bg.beginFill(0x050510)
    bg.drawRect(0, 0, W, H)
    bg.endFill()
    scene.addChild(bg)

    const bgSprite = PR.createCoverSprite('assets/backgrounds/home_bg.jpg', W, H)
    scene.addChild(bgSprite)

    // Logo
    const logo = PR.createSprite('assets/ui/title_logo.png')
    logo.anchor.set(0.5, 0)
    logo.position.set(W / 2, H * 0.08)
    // 等纹理加载后调整尺寸
    const adjustLogo = () => {
      if (!logo.texture || logo.texture === PIXI.Texture.WHITE) return
      const logoW = W * 0.7
      const logoH = logoW * (logo.texture.height / logo.texture.width)
      logo.width = logoW
      logo.height = logoH
    }
    if (logo.texture && logo.texture !== PIXI.Texture.WHITE) adjustLogo()
    else {
      const ci = setInterval(() => {
        if (logo.destroyed) { clearInterval(ci); return }
        if (logo.texture && logo.texture !== PIXI.Texture.WHITE) { adjustLogo(); clearInterval(ci) }
      }, 100)
      setTimeout(() => clearInterval(ci), 5000)
    }
    scene.addChild(logo)

    // 按钮容器（每帧根据状态重建内容）
    const btnContainer = new PIXI.Container()
    btnContainer.name = 'btnContainer'
    scene.addChild(btnContainer)

    this._objects = { btnContainer, scene }
    this._built = true
    this._lastState = ''
    this._buildButtons(g)
  },

  _buildButtons(g) {
    const { btnContainer } = this._objects
    btnContainer.removeChildren()

    const btnW = W * 0.6, btnH = btnW / 4
    const btnX = (W - btnW) / 2
    const hasSave = g.storage.hasSavedRun()
    const stateKey = hasSave ? `save_${g.storage.loadRunState()?.floor || 0}` : 'new'
    if (this._lastState === stateKey) return
    this._lastState = stateKey

    // 按钮用精灵（图片资源）
    const btnRects = {}

    if (hasSave) {
      const saved = g.storage.loadRunState()
      // 继续挑战
      const cby = H * 0.46
      const contBtn = this._makeImgBtn('assets/ui/btn_continue.png', btnX, cby, btnW, btnH, `继续挑战 (第${saved.floor}层)`, 16)
      btnContainer.addChild(contBtn)
      btnRects.continueRect = [btnX, cby, btnW, btnH]

      // 开始挑战
      const sby = H * 0.57
      const startBtn = this._makeImgBtn('assets/ui/btn_start.png', btnX, sby, btnW, btnH, '开始挑战', 15)
      btnContainer.addChild(startBtn)
      btnRects.startRect = [btnX, sby, btnW, btnH]

      // 图鉴
      const dexW = W * 0.5, dexH = dexW / 4
      const dexX = (W - dexW) / 2, dexY = H * 0.68
      const dexBtn = this._makeImgBtn('assets/ui/btn_rank.png', dexX, dexY, dexW, dexH, '图鉴', 15)
      btnContainer.addChild(dexBtn)
      btnRects.dexRect = [dexX, dexY, dexW, dexH]

      // 底部小按钮
      const smGap = 8 * S
      const smW = (W * 0.5 - smGap) / 2, smH = smW / 3.2
      const smStartX = (W - smW * 2 - smGap) / 2
      const smY = H * 0.78

      const statsBtn = this._makeImgBtn('assets/ui/btn_rank.png', smStartX, smY, smW, smH, '统计', 12)
      btnContainer.addChild(statsBtn)
      btnRects.statsRect = [smStartX, smY, smW, smH]

      const rankBtn = this._makeImgBtn('assets/ui/btn_rank.png', smStartX + smW + smGap, smY, smW, smH, '排行', 12)
      btnContainer.addChild(rankBtn)
      btnRects.rankRect = [smStartX + smW + smGap, smY, smW, smH]

      // 反馈
      const feedY = smY + smH + 10 * S
      const feedText = PR.createText('📝 意见反馈', {
        fontSize: 10 * S,
        fill: 'rgba(210,190,160,0.7)',
        fontWeight: 'normal',
        anchor: { x: 0.5, y: 0 },
      })
      feedText.position.set(W * 0.5, feedY + 3 * S)
      btnContainer.addChild(feedText)
      btnRects.feedbackRect = [W * 0.3, feedY, W * 0.4, 20 * S]
    } else {
      // 无存档
      const sby = H * 0.5
      const startBtn = this._makeImgBtn('assets/ui/btn_start.png', btnX, sby, btnW, btnH, '开始挑战', 16)
      btnContainer.addChild(startBtn)
      btnRects.startRect = [btnX, sby, btnW, btnH]

      const dexW = W * 0.5, dexH = dexW / 4
      const dexX = (W - dexW) / 2, dexY = H * 0.62
      const dexBtn = this._makeImgBtn('assets/ui/btn_rank.png', dexX, dexY, dexW, dexH, '图鉴', 15)
      btnContainer.addChild(dexBtn)
      btnRects.dexRect = [dexX, dexY, dexW, dexH]

      const smGap = 8 * S
      const smW = (W * 0.5 - smGap) / 2, smH = smW / 3.2
      const smStartX = (W - smW * 2 - smGap) / 2
      const smY = H * 0.73

      const statsBtn = this._makeImgBtn('assets/ui/btn_rank.png', smStartX, smY, smW, smH, '统计', 12)
      btnContainer.addChild(statsBtn)
      btnRects.statsRect = [smStartX, smY, smW, smH]

      const rankBtn = this._makeImgBtn('assets/ui/btn_rank.png', smStartX + smW + smGap, smY, smW, smH, '排行', 12)
      btnContainer.addChild(rankBtn)
      btnRects.rankRect = [smStartX + smW + smGap, smY, smW, smH]

      const feedY = smY + smH + 10 * S
      const feedText = PR.createText('📝 意见反馈', {
        fontSize: 10 * S,
        fill: 'rgba(210,190,160,0.7)',
        fontWeight: 'normal',
        anchor: { x: 0.5, y: 0 },
      })
      feedText.position.set(W * 0.5, feedY + 3 * S)
      btnContainer.addChild(feedText)
      btnRects.feedbackRect = [W * 0.3, feedY, W * 0.4, 20 * S]
    }

    // 将按钮区域注册到游戏对象（供触摸处理使用）
    g._titleBtnRect = btnRects.startRect
    g._titleContinueRect = btnRects.continueRect || null
    g._dexBtnRect = btnRects.dexRect
    g._statBtnRect = btnRects.statsRect
    g._rankBtnRect = btnRects.rankRect
    g._feedbackBtnRect = btnRects.feedbackRect
  },

  _makeImgBtn(imgPath, x, y, w, h, text, fontSize) {
    const container = new PIXI.Container()
    container.position.set(x, y)

    // 图片按钮
    const sprite = PR.createSprite(imgPath)
    const adjustSize = () => {
      if (!sprite.texture || sprite.texture === PIXI.Texture.WHITE) return
      sprite.width = w
      sprite.height = h
    }
    if (sprite.texture && sprite.texture !== PIXI.Texture.WHITE) adjustSize()
    else {
      const ci = setInterval(() => {
        if (sprite.destroyed) { clearInterval(ci); return }
        if (sprite.texture && sprite.texture !== PIXI.Texture.WHITE) { adjustSize(); clearInterval(ci) }
      }, 100)
      setTimeout(() => clearInterval(ci), 5000)
    }
    // 初始大小（fallback直到纹理加载）
    sprite.width = w
    sprite.height = h
    container.addChild(sprite)

    // 叠加文字
    if (text) {
      const label = PR.createText(text, {
        fontSize: fontSize * S,
        fill: '#5a2d0c',
        fontWeight: 'bold',
        anchor: 0.5,
      })
      label.position.set(w / 2, h / 2)
      container.addChild(label)
    }

    return container
  },

  update(g) {
    if (!this._built) this.build(g)
    // 检查是否需要重建按钮
    const hasSave = g.storage.hasSavedRun()
    const stateKey = hasSave ? `save_${g.storage.loadRunState()?.floor || 0}` : 'new'
    if (this._lastState !== stateKey) {
      this._buildButtons(g)
    }
    // "开始新挑战"确认弹窗
    this._drawNewRunConfirm(g)
  },

  _drawNewRunConfirm(g) {
    const { scene } = this._objects
    if (!scene) return
    // 移除旧弹窗层
    const old = scene.getChildByName('newRunConfirm')
    if (old) scene.removeChild(old)
    if (!g.showNewRunConfirm) return

    const layer = new PIXI.Container()
    layer.name = 'newRunConfirm'
    scene.addChild(layer)

    // 半透明遮罩
    const mask = new PIXI.Graphics()
    mask.beginFill(0x000000, 0.55)
    mask.drawRect(0, 0, W, H)
    mask.endFill()
    layer.addChild(mask)

    // 面板
    const pw = W * 0.82, ph = 175 * S
    const px = (W - pw) / 2, py = (H - ph) / 2

    const panelBg = PR.createSprite('assets/ui/info_panel_bg.png')
    panelBg.position.set(px, py)
    panelBg.width = pw
    panelBg.height = ph
    layer.addChild(panelBg)

    // fallback 面板（图片未加载时）
    const fb = new PIXI.Graphics()
    fb.beginFill(0xf8f2e6, 0.97)
    fb.drawRoundedRect(px, py, pw, ph, 14 * S)
    fb.endFill()
    fb.lineStyle(1.5 * S, 0xc9a84c, 0.4)
    fb.drawRoundedRect(px, py, pw, ph, 14 * S)
    layer.addChildAt(fb, layer.children.length - 1) // 在sprite下面
    // 图片加载后隐藏 fallback
    const checkTex = () => {
      if (panelBg.texture && panelBg.texture !== PIXI.Texture.WHITE) { fb.visible = false }
    }
    checkTex()
    if (fb.visible) {
      const ci = setInterval(() => { checkTex(); if (!fb.visible || panelBg.destroyed) clearInterval(ci) }, 100)
      setTimeout(() => clearInterval(ci), 3000)
    }

    // 标题
    const title = PR.createText('开始新挑战', {
      fontSize: 16 * S, fill: '#6B5014', fontWeight: 'bold', anchor: { x: 0.5, y: 0 },
    })
    title.position.set(px + pw * 0.5, py + 18 * S)
    layer.addChild(title)

    // 说明
    const desc1 = PR.createText('当前有未完成的挑战进度', {
      fontSize: 11 * S, fill: '#7B7060', anchor: { x: 0.5, y: 0 },
    })
    desc1.position.set(px + pw * 0.5, py + 55 * S)
    layer.addChild(desc1)

    const desc2 = PR.createText('开始新挑战将清空之前的记录！', {
      fontSize: 11 * S, fill: '#C0392B', fontWeight: 'bold', anchor: { x: 0.5, y: 0 },
    })
    desc2.position.set(px + pw * 0.5, py + 75 * S)
    layer.addChild(desc2)

    // 按钮
    const btnW = pw * 0.34, btnH = 34 * S, gap = 14 * S
    const btn1X = px + pw * 0.5 - btnW - gap * 0.5
    const btn2X = px + pw * 0.5 + gap * 0.5
    const btnY = py + 110 * S

    // 取消按钮
    const cancelBtn = PR.createButton({ x: btn1X, y: btnY, w: btnW, h: btnH, text: '取消', color: '#d4c9a0' })
    layer.addChild(cancelBtn)
    g._newRunCancelRect = [btn1X, btnY, btnW, btnH]

    // 确认按钮
    const confirmBtn = PR.createButton({ x: btn2X, y: btnY, w: btnW, h: btnH, text: '确认开始', color: '#C0392B' })
    layer.addChild(confirmBtn)
    g._newRunConfirmRect = [btn2X, btnY, btnW, btnH]
  },
})

// ===== Gameover 场景（PixiJS原生）=====
registerScene('gameover', {
  _built: false,
  _lastKey: '',
  build(g) { this._built = true },
  update(g) {
    const scene = SceneManager.getScene('gameover')
    if (!scene) return
    const key = `${g.cleared}_${g.floor}_${g.storage.bestFloor}_${(g.pets||[]).map(p=>p.name).join()}_${g.weapon?g.weapon.name:''}`
    if (this._lastKey === key) return
    this._lastKey = key
    scene.removeChildren()
    const { ATTR_COLOR } = require('./data/tower')

    // 背景
    const bgContainer = PR.createSceneBg({
      bgColor: '#0d0d1a',
    })
    scene.addChild(bgContainer)
    // 星空效果
    const starsBg = new PIXI.Graphics()
    const t = g.af * 0.01
    R.bgStars.forEach(s => {
      const alpha = 0.15 + 0.2 * Math.sin(t * s.sp * 5 + s.ph)
      starsBg.beginFill(0xffffff, alpha)
      starsBg.drawCircle(s.x, (s.y + g.af * s.sp * 0.3) % H, s.r * S)
      starsBg.endFill()
    })
    scene.addChild(starsBg)

    if (g.cleared) {
      // 通关 - 金色光芒
      const glow = new PIXI.Graphics()
      glow.beginFill(0xffd700, 0.15)
      glow.drawCircle(W*0.5, H*0.25, W*0.6)
      glow.endFill()
      scene.addChild(glow)

      const title = PR.createText('通天塔·通关', { fontSize: 28*S, fill: '#ffd700', fontWeight: 'bold', anchor: 0.5, stroke: '#000000', strokeThickness: 4*S })
      title.position.set(W*0.5, H*0.16)
      scene.addChild(title)

      const sub1 = PR.createText('恭喜修士登顶通天塔！', { fontSize: 16*S, fill: '#f0e0c0', anchor: 0.5 })
      sub1.position.set(W*0.5, H*0.24)
      scene.addChild(sub1)

      const floorText = PR.createText(`通关层数：第 ${g.floor > 60 ? 60 : g.floor} 层`, { fontSize: 18*S, fill: '#e8a840', fontWeight: 'bold', anchor: 0.5 })
      floorText.position.set(W*0.5, H*0.32)
      scene.addChild(floorText)
    } else {
      // 失败 - 暗红
      const glow = new PIXI.Graphics()
      glow.beginFill(0xc8323c, 0.1)
      glow.drawCircle(W*0.5, H*0.2, W*0.4)
      glow.endFill()
      scene.addChild(glow)

      const title = PR.createText('挑战结束', { fontSize: 26*S, fill: '#ff4d6a', fontWeight: 'bold', anchor: 0.5, stroke: '#000000', strokeThickness: 4*S })
      title.position.set(W*0.5, H*0.18)
      scene.addChild(title)

      const floorText = PR.createText(`本次到达：第 ${g.floor} 层`, { fontSize: 20*S, fill: '#ffd700', fontWeight: 'bold', anchor: 0.5 })
      floorText.position.set(W*0.5, H*0.30)
      scene.addChild(floorText)
    }
    // 历史最高
    const bestText = PR.createText(`历史最高：第 ${g.storage.bestFloor} 层`, { fontSize: 14*S, fill: 'rgba(200,200,210,0.7)', anchor: 0.5 })
    bestText.position.set(W*0.5, H*0.38)
    scene.addChild(bestText)

    // 阵容面板
    const panelW = W*0.86, panelH = 120*S
    const panelX = (W - panelW)/2, panelY = H*0.44
    const panel = PR.createDarkCard(panelX, panelY, panelW, panelH)
    scene.addChild(panel)

    const teamLabel = PR.createText('上场灵兽', { fontSize: 12*S, fill: '#f0dca0', fontWeight: 'bold', anchor: 0.5 })
    teamLabel.position.set(W*0.5, panelY + 20*S)
    scene.addChild(teamLabel)

    if (g.pets) {
      g.pets.forEach((p, i) => {
        const ac = ATTR_COLOR[p.attr]
        const petName = PR.createText(p.name, { fontSize: 12*S, fill: ac ? ac.main : '#eeeeee', anchor: 0.5 })
        petName.position.set(W*0.1 + i*W*0.18, panelY + 42*S)
        scene.addChild(petName)
      })
    }
    if (g.weapon) {
      const wpnText = PR.createText(`法宝·${g.weapon.name}`, { fontSize: 12*S, fill: '#e0a020', anchor: 0.5 })
      wpnText.position.set(W*0.5, panelY + 68*S)
      scene.addChild(wpnText)
    }
    const bagInfo = PR.createText(`灵兽背包：${g.petBag.length}只  法宝背包：${g.weaponBag.length}件`, { fontSize: 11*S, fill: 'rgba(140,140,160,0.5)', anchor: 0.5 })
    bagInfo.position.set(W*0.5, panelY + 92*S)
    scene.addChild(bagInfo)

    // 重新挑战按钮
    const bx = W*0.25, by = panelY + panelH + 20*S, bw = W*0.5, bh = 48*S
    const btn = PR.createButton({ x: bx, y: by, w: bw, h: bh, text: g.cleared ? '再次挑战' : '重新挑战', color: '#ffd700' })
    scene.addChild(btn)
    g._goBtnRect = [bx, by, bw, bh]

    // 返回按钮
    scene.addChild(PR.createBackBtn(g))
  },
})

// ===== Shop 场景（PixiJS原生）=====
registerScene('shop', {
  _built: false,
  _lastKey: '',
  build(g) { this._built = true },
  update(g) {
    const scene = SceneManager.getScene('shop')
    if (!scene) return
    const key = `${g.shopUsed}_${(g.shopItems||[]).map(i=>i.name).join()}`
    if (this._lastKey === key) return
    this._lastKey = key
    scene.removeChildren()

    scene.addChild(PR.createSceneBg({ bgColor: '#1a1008', bgImage: 'assets/backgrounds/shop_bg.jpg', overlay: '#0a0800', overlayAlpha: 0.25 }))
    scene.addChild(PR.createTitleHeader('神秘商店', { dividerWidth: W*0.25 }))

    const subText = PR.createText(g.shopUsed ? '已选择物品' : '免费选择一件', { fontSize: 13*S, fill: g.shopUsed ? 'rgba(140,140,160,0.5)' : '#e8a840', anchor: 0.5 })
    subText.position.set(W*0.5, safeTop + 68*S)
    scene.addChild(subText)

    if (!g.shopItems) return
    const cardW = W*0.84, cardH = 62*S, gap = 10*S, startY = safeTop + 90*S
    g._shopRects = []
    g.shopItems.forEach((item, i) => {
      const cx = (W - cardW)/2, cy = startY + i*(cardH+gap)
      const card = PR.createDarkCard(cx, cy, cardW, cardH)
      scene.addChild(card)
      // 左侧装饰竖条
      const deco = new PIXI.Graphics()
      deco.beginFill(0xd4af37, 0.4)
      deco.drawRoundedRect(cx + 4*S, cy + 6*S, 3*S, cardH - 12*S, 1.5*S)
      deco.endFill()
      scene.addChild(deco)
      // 名称
      const name = PR.createText(item.name, { fontSize: 14*S, fill: '#f0dca0', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
      name.position.set(cx + 16*S, cy + 26*S)
      scene.addChild(name)
      if (item.desc) {
        const desc = PR.createText(item.desc, { fontSize: 11*S, fill: 'rgba(200,200,210,0.7)', anchor: { x: 0, y: 0.5 } })
        desc.position.set(cx + 16*S, cy + 46*S)
        scene.addChild(desc)
      }
      g._shopRects.push([cx, cy, cardW, cardH])
    })
    // 离开按钮
    const bx = W*0.3, by = H*0.82, bw = W*0.4, bh = 40*S
    const leaveBtn = PR.createButton({ x: bx, y: by, w: bw, h: bh, text: '离开', color: '#4dabff' })
    scene.addChild(leaveBtn)
    g._shopLeaveRect = [bx, by, bw, bh]
    scene.addChild(PR.createBackBtn(g))
  },
})

// ===== Rest 场景（PixiJS原生）=====
registerScene('rest', {
  _built: false,
  _lastKey: '',
  build(g) { this._built = true },
  update(g) {
    const scene = SceneManager.getScene('rest')
    if (!scene) return
    const key = `${(g.restOpts||[]).map(o=>o.name).join()}`
    if (this._lastKey === key) return
    this._lastKey = key
    scene.removeChildren()

    scene.addChild(PR.createSceneBg({ bgImage: 'assets/backgrounds/rest_bg.jpg', overlay: '#000000', overlayAlpha: 0.35 }))
    scene.addChild(PR.createTitleHeader('休息之地', { dividerWidth: W*0.25 }))

    const sub = PR.createText('选择一项恢复方式', { fontSize: 12*S, fill: 'rgba(200,200,210,0.7)', anchor: 0.5 })
    sub.position.set(W*0.5, safeTop + 66*S)
    scene.addChild(sub)

    if (!g.restOpts) return
    const cardW = W*0.78, cardH = 72*S, gap = 14*S, startY = safeTop + 90*S
    const restIcons = ['🧘', '💊', '🛡']
    g._restRects = []
    g.restOpts.forEach((opt, i) => {
      const cx = (W - cardW)/2, cy = startY + i*(cardH+gap)
      const card = PR.createDarkCard(cx, cy, cardW, cardH)
      scene.addChild(card)
      // 图标区
      const iconSz = 36*S, iconX = cx + 14*S, iconY = cy + (cardH - iconSz)/2
      const iconBg = new PIXI.Graphics()
      iconBg.beginFill(0xd4af37, 0.1)
      iconBg.drawRoundedRect(iconX, iconY, iconSz, iconSz, 8*S)
      iconBg.endFill()
      iconBg.lineStyle(0.5*S, 0xd4af37, 0.3)
      iconBg.drawRoundedRect(iconX, iconY, iconSz, iconSz, 8*S)
      scene.addChild(iconBg)
      const icon = PR.createText(restIcons[i] || '✨', { fontSize: 20*S, anchor: 0.5 })
      icon.position.set(iconX + iconSz/2, iconY + iconSz/2)
      scene.addChild(icon)
      // 文字
      const name = PR.createText(opt.name, { fontSize: 15*S, fill: '#f0dca0', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
      name.position.set(iconX + iconSz + 12*S, cy + 30*S)
      scene.addChild(name)
      const desc = PR.createText(opt.desc, { fontSize: 11*S, fill: 'rgba(200,200,210,0.7)', anchor: { x: 0, y: 0.5 } })
      desc.position.set(iconX + iconSz + 12*S, cy + 50*S)
      scene.addChild(desc)
      g._restRects.push([(W - cardW)/2, cy, cardW, cardH])
    })
    scene.addChild(PR.createBackBtn(g))
  },
})

// ===== Adventure 场景（PixiJS原生）=====
registerScene('adventure', {
  _built: false,
  _lastKey: '',
  build(g) { this._built = true },
  update(g) {
    const scene = SceneManager.getScene('adventure')
    if (!scene) return
    const key = `${g.adventureData?g.adventureData.name:''}_${g._adventureResult||''}`
    if (this._lastKey === key) return
    this._lastKey = key
    scene.removeChildren()

    scene.addChild(PR.createSceneBg({ bgImage: 'assets/backgrounds/adventure_bg.jpg', overlay: '#000000', overlayAlpha: 0.35 }))
    scene.addChild(PR.createTitleHeader('奇遇', { dividerWidth: W*0.18 }))

    if (!g.adventureData) return
    // 内容面板
    const panelW = W*0.82, panelH = 160*S
    const panelX = (W - panelW)/2, panelY = H*0.26
    const panel = PR.createDarkCard(panelX, panelY, panelW, panelH, 12*S)
    scene.addChild(panel)
    // 奇遇名
    const name = PR.createText(g.adventureData.name, { fontSize: 18*S, fill: '#f0dca0', fontWeight: 'bold', anchor: 0.5 })
    name.position.set(W*0.5, panelY + 42*S)
    scene.addChild(name)
    // 描述
    const desc = PR.createText(g.adventureData.desc, { fontSize: 13*S, fill: '#ffffff', anchor: 0.5, stroke: '#000000', strokeThickness: 3*S })
    desc.position.set(W*0.5, panelY + 72*S)
    scene.addChild(desc)
    // 具体获得结果
    if (g._adventureResult) {
      const result = PR.createText(g._adventureResult, { fontSize: 13*S, fill: '#ffd54f', fontWeight: 'bold', anchor: 0.5 })
      result.position.set(W*0.5, panelY + 94*S)
      scene.addChild(result)
    }
    // 效果标记
    const effect = PR.createText('✦ 效果已生效 ✦', { fontSize: 14*S, fill: '#ffe066', fontWeight: 'bold', anchor: 0.5, stroke: '#000000', strokeThickness: 3*S })
    effect.position.set(W*0.5, panelY + (g._adventureResult ? 120 : 116)*S)
    scene.addChild(effect)
    // 继续按钮
    const bx = W*0.3, by = H*0.68, bw = W*0.4, bh = 44*S
    const btn = PR.createButton({ x: bx, y: by, w: bw, h: bh, text: '继续', color: '#ffd700' })
    scene.addChild(btn)
    g._advBtnRect = [bx, by, bw, bh]
    scene.addChild(PR.createBackBtn(g))
  },
})

// ===== Stats 场景（PixiJS原生）=====
registerScene('stats', {
  _built: false,
  _lastKey: '',
  build(g) { this._built = true },
  update(g) {
    const scene = SceneManager.getScene('stats')
    if (!scene) return
    const _st = g.storage.stats
    const key = `${g.storage.bestFloor}_${_st.totalBattles}_${_st.maxCombo}_${_st.totalCombos}_${(g.storage.petDex||[]).length}_${_st.bestTotalTurns||0}`
    if (this._lastKey === key) return
    this._lastKey = key
    scene.removeChildren()
    const { ATTR_COLOR } = require('./data/tower')

    scene.addChild(PR.createSceneBg({ bgImage: 'assets/backgrounds/home_bg.jpg', overlay: '#000000', overlayAlpha: 0.4 }))
    scene.addChild(PR.createTitleHeader('我的战绩'))

    const padX = 14*S
    const st = g.storage.stats
    const heroW = W - padX*2

    // 核心成就卡片
    const heroY = safeTop + 58*S, heroH = 70*S
    const heroCard = PR.createInfoPanel(padX, heroY, heroW, heroH, 12*S)
    scene.addChild(heroCard)
    // 左侧最高层
    const bestFloor = g.storage.bestFloor
    const isCleared = bestFloor >= 30
    const floorVal = PR.createText(isCleared ? '通关' : `第 ${bestFloor} 层`, { fontSize: 28*S, fill: '#8B6914', fontWeight: 'bold', anchor: 0.5 })
    floorVal.position.set(W*0.3, heroY + 30*S)
    scene.addChild(floorVal)
    const floorLabel = PR.createText(isCleared ? '已登顶通天塔' : '最高层数', { fontSize: 10*S, fill: '#9B8B70', anchor: 0.5 })
    floorLabel.position.set(W*0.3, heroY + 50*S)
    scene.addChild(floorLabel)
    // 分隔线
    const divLine = new PIXI.Graphics()
    divLine.lineStyle(1*S, 0xc9a84c, 0.3)
    divLine.moveTo(W*0.5, heroY + 12*S)
    divLine.lineTo(W*0.5, heroY + heroH - 12*S)
    scene.addChild(divLine)
    // 右侧最快
    const bestTurns = st.bestTotalTurns || 0
    if (bestTurns > 0) {
      const turnsVal = PR.createText(`${bestTurns}`, { fontSize: 28*S, fill: '#C0392B', fontWeight: 'bold', anchor: 0.5 })
      turnsVal.position.set(W*0.7, heroY + 30*S)
      scene.addChild(turnsVal)
      const turnsLabel = PR.createText('最速通关回合', { fontSize: 10*S, fill: '#9B8B70', anchor: 0.5 })
      turnsLabel.position.set(W*0.7, heroY + 50*S)
      scene.addChild(turnsLabel)
    } else {
      const noData = PR.createText('—', { fontSize: 16*S, fill: '#bbb0a0', fontWeight: 'bold', anchor: 0.5 })
      noData.position.set(W*0.7, heroY + 30*S)
      scene.addChild(noData)
      const noLabel = PR.createText('通关后解锁', { fontSize: 10*S, fill: '#bbb0a0', anchor: 0.5 })
      noLabel.position.set(W*0.7, heroY + 50*S)
      scene.addChild(noLabel)
    }

    // 6项统计
    const gridY = heroY + heroH + 10*S
    const colCount = 3, rowCount = 2
    const colGap = 6*S, rowGap = 6*S
    const colW = (heroW - colGap*(colCount-1)) / colCount
    const cardH = 56*S
    const dexCount = (g.storage.petDex || []).length
    const avgVal = st.totalBattles > 0 ? (st.totalCombos / st.totalBattles).toFixed(1) : '0'
    const statCards = [
      { label: '总挑战', value: `${g.storage.totalRuns}`, unit: '次', color: '#ffd700' },
      { label: '总战斗', value: `${st.totalBattles}`, unit: '场', color: '#4dabff' },
      { label: '图鉴收集', value: `${dexCount}`, unit: '/100', color: '#4dcc4d' },
      { label: '最高连击', value: `${st.maxCombo}`, unit: '连', color: '#ff6b6b' },
      { label: '总Combo', value: `${st.totalCombos}`, unit: '次', color: '#e0a020' },
      { label: '场均Combo', value: `${avgVal}`, unit: '次', color: '#c084fc' },
    ]
    statCards.forEach((card, i) => {
      const col = i % colCount, row = Math.floor(i / colCount)
      const cx = padX + col*(colW+colGap)
      const cy = gridY + row*(cardH+rowGap)
      const bg = PR.createInfoPanel(cx, cy, colW, cardH, 8*S)
      scene.addChild(bg)
      const val = PR.createText(card.value, { fontSize: 18*S, fill: card.color, fontWeight: 'bold', anchor: 0.5 })
      val.position.set(cx + colW*0.5, cy + 22*S)
      scene.addChild(val)
      const label = PR.createText(card.label, { fontSize: 10*S, fill: '#6B5B40', fontWeight: 'bold', anchor: 0.5 })
      label.position.set(cx + colW*0.5, cy + 43*S)
      scene.addChild(label)
    })

    // 图鉴进度条
    const barY = gridY + rowCount*(cardH+rowGap) + 4*S, barH = 30*S
    const barPanel = PR.createInfoPanel(padX, barY, heroW, barH, 8*S)
    scene.addChild(barPanel)
    const dexLabel = PR.createText('图鉴进度', { fontSize: 10*S, fill: '#8B7B60', anchor: { x: 0, y: 0.5 } })
    dexLabel.position.set(padX + 10*S, barY + barH*0.5)
    scene.addChild(dexLabel)
    const dexVal = PR.createText(`${dexCount}/100`, { fontSize: 11*S, fill: '#2d8c2d', fontWeight: 'bold', anchor: { x: 1, y: 0.5 } })
    dexVal.position.set(W - padX - 10*S, barY + barH*0.5)
    scene.addChild(dexVal)
    // 进度条
    const pbX = padX + 80*S, pbY2 = barY + 10*S, pbW = heroW - 94*S, pbH = 10*S
    const pctVal = Math.min(dexCount/100, 1)
    const barBg = new PIXI.Graphics()
    barBg.beginFill(0x000000, 0.06)
    barBg.drawRoundedRect(pbX, pbY2, pbW, pbH, pbH*0.5)
    barBg.endFill()
    scene.addChild(barBg)
    if (pctVal > 0) {
      const barFill = new PIXI.Graphics()
      barFill.beginFill(0x4dcc4d)
      barFill.drawRoundedRect(pbX, pbY2, pbW*pctVal, pbH, pbH*0.5)
      barFill.endFill()
      scene.addChild(barFill)
    }

    // 最高记录阵容
    const teamY = barY + barH + 10*S, teamH = 70*S
    const teamPanel = PR.createInfoPanel(padX, teamY, heroW, teamH, 10*S)
    scene.addChild(teamPanel)
    const teamTitle = PR.createText('✦ 最高记录阵容 ✦', { fontSize: 10*S, fill: '#8B6914', fontWeight: 'bold', anchor: 0.5 })
    teamTitle.position.set(W*0.5, teamY + 16*S)
    scene.addChild(teamTitle)
    const bfPets = st.bestFloorPets || []
    if (bfPets.length > 0) {
      const petW = heroW / Math.max(bfPets.length, 1)
      bfPets.forEach((p, i) => {
        const px = padX + petW*i + petW*0.5
        const ac = ATTR_COLOR[p.attr]
        const pn = PR.createText(p.name, { fontSize: 11*S, fill: ac ? ac.main : '#eeeeee', fontWeight: 'bold', anchor: 0.5 })
        pn.position.set(px, teamY + 38*S)
        scene.addChild(pn)
      })
      const bfWeapon = st.bestFloorWeapon
      if (bfWeapon) {
        const wpn = PR.createText(`法宝·${bfWeapon.name}`, { fontSize: 10*S, fill: '#8B6914', anchor: 0.5 })
        wpn.position.set(W*0.5, teamY + 58*S)
        scene.addChild(wpn)
      }
    } else {
      const noTeam = PR.createText('暂无记录', { fontSize: 12*S, fill: '#bbb0a0', anchor: 0.5 })
      noTeam.position.set(W*0.5, teamY + 42*S)
      scene.addChild(noTeam)
    }

    // 分享按钮
    const shareBtnW = W*0.52, shareBtnH = 36*S
    const shareBtnX = (W - shareBtnW)/2, shareBtnY = teamY + teamH + 14*S
    const shareBg = new PIXI.Graphics()
    shareBg.beginFill(0xd4a840)
    shareBg.drawRoundedRect(shareBtnX, shareBtnY, shareBtnW, shareBtnH, shareBtnH*0.5)
    shareBg.endFill()
    shareBg.lineStyle(1*S, 0xa08228, 0.35)
    shareBg.drawRoundedRect(shareBtnX, shareBtnY, shareBtnW, shareBtnH, shareBtnH*0.5)
    scene.addChild(shareBg)
    const shareLabel = PR.createText('分享战绩给好友', { fontSize: 13*S, fill: '#4A3010', fontWeight: 'bold', anchor: 0.5 })
    shareLabel.position.set(shareBtnX + shareBtnW/2, shareBtnY + shareBtnH/2)
    scene.addChild(shareLabel)
    g._statsShareBtnRect = [shareBtnX, shareBtnY, shareBtnW, shareBtnH]

    scene.addChild(PR.createBackBtn(g))
  },
})

// ===== Ranking 场景（PixiJS原生）=====
registerScene('ranking', {
  _built: false,
  _lastKey: '',
  build(g) { this._built = true },
  update(g) {
    const scene = SceneManager.getScene('ranking')
    if (!scene) return
    const _tab = g.rankTab || 'all'
    const _listMap = { all: 'rankAllList', dex: 'rankDexList', combo: 'rankComboList' }
    const _list = g.storage[_listMap[_tab]] || []
    const key = `${_tab}_${g.storage.rankLoading}_${_list.length}_${Math.round(g.rankScrollY||0)}`
    if (this._lastKey === key) return
    this._lastKey = key
    scene.removeChildren()

    scene.addChild(PR.createSceneBg({ bgImage: 'assets/backgrounds/home_bg.jpg', overlay: '#000000', overlayAlpha: 0.4 }))
    scene.addChild(PR.createTitleHeader('排行榜'))

    const padX = 12*S
    const tab = g.rankTab || 'all'

    // 刷新按钮
    const rfW = 40*S, rfH = 22*S
    const rfX = W*0.5 + 50*S, rfY = safeTop + 40*S - rfH*0.5
    const rfBg = new PIXI.Graphics()
    rfBg.beginFill(0x281e0f, g.storage.rankLoading ? 0.5 : 0.75)
    rfBg.drawRoundedRect(rfX, rfY, rfW, rfH, rfH*0.5)
    rfBg.endFill()
    rfBg.lineStyle(0.5*S, 0xd4af37, g.storage.rankLoading ? 0.15 : 0.35)
    rfBg.drawRoundedRect(rfX, rfY, rfW, rfH, rfH*0.5)
    scene.addChild(rfBg)
    const rfLabel = PR.createText(g.storage.rankLoading ? '刷新中' : '刷新', {
      fontSize: 9*S, fill: g.storage.rankLoading ? 'rgba(240,220,160,0.35)' : 'rgba(240,220,160,0.8)', anchor: 0.5
    })
    rfLabel.position.set(rfX + rfW/2, rfY + rfH/2)
    scene.addChild(rfLabel)
    g._rankRefreshRect = [rfX, rfY, rfW, rfH]

    // Tab切换
    const tabY = safeTop + 56*S, tabH = 28*S
    const tabs = [
      { key: 'all', label: '速通榜' },
      { key: 'dex', label: '图鉴榜' },
      { key: 'combo', label: '连击榜' },
    ]
    const tabGap = 6*S
    const totalTabW = W - padX*2 - tabGap*(tabs.length-1)
    const singleTabW = totalTabW / tabs.length
    g._rankTabRects = {}
    tabs.forEach((t, i) => {
      const tx = padX + i*(singleTabW+tabGap)
      const isActive = tab === t.key
      const tabBg = new PIXI.Graphics()
      if (isActive) {
        tabBg.beginFill(0xf0c040)
        tabBg.drawRoundedRect(tx, tabY, singleTabW, tabH, tabH*0.5)
        tabBg.endFill()
        tabBg.lineStyle(1*S, 0xd4af37, 0.5)
        tabBg.drawRoundedRect(tx, tabY, singleTabW, tabH, tabH*0.5)
      } else {
        tabBg.beginFill(0xffffff, 0.06)
        tabBg.drawRoundedRect(tx, tabY, singleTabW, tabH, tabH*0.5)
        tabBg.endFill()
      }
      scene.addChild(tabBg)
      const tabLabel = PR.createText(t.label, { fontSize: 10*S, fill: isActive ? '#2a1a00' : 'rgba(200,200,210,0.7)', fontWeight: 'bold', anchor: 0.5 })
      tabLabel.position.set(tx + singleTabW*0.5, tabY + tabH*0.5)
      scene.addChild(tabLabel)
      g._rankTabRects[t.key] = [tx, tabY, singleTabW, tabH]
    })

    // 列表区域
    const listTop = tabY + tabH + 10*S
    const myBarH = 52*S
    const listBottom = H - myBarH - 16*S
    const rowH = 64*S
    const listMap = { all: 'rankAllList', dex: 'rankDexList', combo: 'rankComboList' }
    const rankMap = { all: 'rankAllMyRank', dex: 'rankDexMyRank', combo: 'rankComboMyRank' }
    const list = g.storage[listMap[tab]] || []
    const myRank = g.storage[rankMap[tab]] || -1

    // 列表面板背景
    const listBg = new PIXI.Graphics()
    listBg.beginFill(0x1e1912, 0.72)
    listBg.drawRoundedRect(padX, listTop, W - padX*2, listBottom - listTop, 10*S)
    listBg.endFill()
    listBg.lineStyle(0.5*S, 0xd4af37, 0.15)
    listBg.drawRoundedRect(padX, listTop, W - padX*2, listBottom - listTop, 10*S)
    scene.addChild(listBg)

    // 表头
    const headerH = 26*S
    const headerBg = new PIXI.Graphics()
    headerBg.beginFill(0xd4af37, 0.08)
    headerBg.drawRoundedRect(padX+1, listTop+1, W-padX*2-2, headerH, 8*S)
    headerBg.endFill()
    scene.addChild(headerBg)
    const hRank = PR.createText('排名', { fontSize: 10*S, fill: 'rgba(140,140,160,0.5)', anchor: { x: 0, y: 0.5 } })
    hRank.position.set(padX + 10*S, listTop + headerH*0.5)
    scene.addChild(hRank)
    const hPlayer = PR.createText('玩家', { fontSize: 10*S, fill: 'rgba(140,140,160,0.5)', anchor: { x: 0, y: 0.5 } })
    hPlayer.position.set(padX + 52*S, listTop + headerH*0.5)
    scene.addChild(hPlayer)
    const scoreLabel = tab === 'dex' ? '图鉴数' : tab === 'combo' ? '最高连击' : '成绩'
    const hScore = PR.createText(scoreLabel, { fontSize: 10*S, fill: 'rgba(140,140,160,0.5)', anchor: { x: 1, y: 0.5 } })
    hScore.position.set(W - padX - 10*S, listTop + headerH*0.5)
    scene.addChild(hScore)

    const contentTop = listTop + headerH + 2*S
    // 创建列表容器并用mask裁剪
    const listContainer = new PIXI.Container()
    const listMask = new PIXI.Graphics()
    listMask.beginFill(0xffffff)
    listMask.drawRect(padX, contentTop, W - padX*2, listBottom - contentTop - 4*S)
    listMask.endFill()
    scene.addChild(listMask)
    listContainer.mask = listMask
    scene.addChild(listContainer)

    if (g.storage.rankLoading && list.length === 0) {
      const msg = PR.createText(g.storage.rankLoadingMsg || '加载中...', { fontSize: 14*S, fill: 'rgba(200,200,210,0.7)', anchor: 0.5 })
      msg.position.set(W*0.5, contentTop + 60*S)
      listContainer.addChild(msg)
    } else if (list.length === 0) {
      const empty = PR.createText('暂无数据', { fontSize: 14*S, fill: 'rgba(140,140,160,0.5)', anchor: 0.5 })
      empty.position.set(W*0.5, contentTop + 60*S)
      listContainer.addChild(empty)
    } else {
      const medalColors = [0xffd700, 0xc0c0c0, 0xcd7f32]
      for (let i = 0; i < list.length; i++) {
        const item = list[i]
        const ry = contentTop + i*rowH + (g.rankScrollY || 0)
        if (ry + rowH < contentTop || ry > listBottom) continue
        // 行背景
        const rowBg = new PIXI.Graphics()
        if (i < 3) {
          rowBg.beginFill(medalColors[i], 0.08)
        } else {
          rowBg.beginFill(i%2 === 0 ? 0xffffff : 0x000000, i%2 === 0 ? 0.02 : 0.06)
        }
        rowBg.drawRect(padX+2*S, ry+1*S, W-padX*2-4*S, rowH-3*S)
        rowBg.endFill()
        listContainer.addChild(rowBg)
        // 排名
        if (i < 3) {
          const medalBg = new PIXI.Graphics()
          medalBg.beginFill(medalColors[i], 0.2)
          medalBg.drawCircle(padX + 18*S, ry + rowH*0.5, 13*S)
          medalBg.endFill()
          listContainer.addChild(medalBg)
          const medalText = PR.createText(`${i+1}`, { fontSize: 14*S, fill: i===0?'#ffd700':i===1?'#c0c0c0':'#cd7f32', fontWeight: 'bold', anchor: 0.5 })
          medalText.position.set(padX + 18*S, ry + rowH*0.5)
          listContainer.addChild(medalText)
        } else {
          const rankNum = PR.createText(`${i+1}`, { fontSize: 13*S, fill: 'rgba(140,140,160,0.5)', fontWeight: 'bold', anchor: 0.5 })
          rankNum.position.set(padX + 18*S, ry + rowH*0.5)
          listContainer.addChild(rankNum)
        }
        // 头像占位（圆形）
        const avatarX = padX + 40*S, avatarY2 = ry + (rowH-34*S)/2, avatarSz = 34*S
        const avCircle = new PIXI.Graphics()
        avCircle.beginFill(0xffffff, 0.08)
        avCircle.drawCircle(avatarX + avatarSz/2, avatarY2 + avatarSz/2, avatarSz/2)
        avCircle.endFill()
        listContainer.addChild(avCircle)
        if (item.avatarUrl) {
          const avSprite = PR.createSprite(item.avatarUrl)
          avSprite.width = avatarSz
          avSprite.height = avatarSz
          avSprite.position.set(avatarX, avatarY2)
          // 圆形 mask
          const avMask = new PIXI.Graphics()
          avMask.beginFill(0xffffff)
          avMask.drawCircle(avatarX + avatarSz/2, avatarY2 + avatarSz/2, avatarSz/2)
          avMask.endFill()
          listContainer.addChild(avMask)
          avSprite.mask = avMask
          listContainer.addChild(avSprite)
        } else {
          const qMark = PR.createText('?', { fontSize: 14*S, fill: 'rgba(140,140,160,0.5)', anchor: 0.5 })
          qMark.position.set(avatarX + avatarSz/2, avatarY2 + avatarSz/2)
          listContainer.addChild(qMark)
        }
        // 昵称
        const textX = avatarX + avatarSz + 8*S
        const nick = PR.createText((item.nickName||'修士').substring(0,8), { fontSize: 13*S, fill: i<3?'#f0dca0':'#eeeeee', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
        nick.position.set(textX, ry + 26*S)
        listContainer.addChild(nick)
        // 右侧数值
        if (tab === 'all') {
          const floorVal = PR.createText(`${item.floor}`, { fontSize: 20*S, fill: i<3?'#ffd700':'#ffd700', fontWeight: 'bold', anchor: { x: 1, y: 0.5 } })
          floorVal.position.set(W - padX - 12*S, ry + 24*S)
          listContainer.addChild(floorVal)
          const unitText = PR.createText('层', { fontSize: 9*S, fill: 'rgba(140,140,160,0.5)', anchor: { x: 1, y: 0 } })
          unitText.position.set(W - padX - 12*S, ry + 32*S)
          listContainer.addChild(unitText)
          if (item.totalTurns > 0) {
            const turnsText = PR.createText(`${item.totalTurns}回合`, { fontSize: 10*S, fill: i<3?'rgba(240,220,160,0.7)':'rgba(200,200,210,0.7)', anchor: { x: 1, y: 0 } })
            turnsText.position.set(W - padX - 12*S, ry + 44*S)
            listContainer.addChild(turnsText)
          }
        } else if (tab === 'dex') {
          const dexVal = PR.createText(`${item.petDexCount||0}`, { fontSize: 20*S, fill: i<3?'#ffd700':'#4dcc4d', fontWeight: 'bold', anchor: { x: 1, y: 0.5 } })
          dexVal.position.set(W - padX - 12*S, ry + 30*S)
          listContainer.addChild(dexVal)
          const unitT = PR.createText('/100', { fontSize: 9*S, fill: 'rgba(140,140,160,0.5)', anchor: { x: 1, y: 0 } })
          unitT.position.set(W - padX - 12*S, ry + 42*S)
          listContainer.addChild(unitT)
        } else if (tab === 'combo') {
          const comboVal = PR.createText(`${item.maxCombo||0}`, { fontSize: 20*S, fill: i<3?'#ffd700':'#ff6b6b', fontWeight: 'bold', anchor: { x: 1, y: 0.5 } })
          comboVal.position.set(W - padX - 12*S, ry + 30*S)
          listContainer.addChild(comboVal)
          const unitT = PR.createText('连击', { fontSize: 9*S, fill: 'rgba(140,140,160,0.5)', anchor: { x: 1, y: 0 } })
          unitT.position.set(W - padX - 12*S, ry + 42*S)
          listContainer.addChild(unitT)
        }
      }
    }

    // 底部我的排名栏
    const myBarY = listBottom + 6*S
    const myBar = new PIXI.Graphics()
    myBar.beginFill(0x32280a, 0.9)
    myBar.drawRoundedRect(padX, myBarY, W-padX*2, myBarH, 10*S)
    myBar.endFill()
    myBar.lineStyle(1.5*S, 0xd4af37, 0.35)
    myBar.drawRoundedRect(padX, myBarY, W-padX*2, myBarH, 10*S)
    scene.addChild(myBar)
    // 我的头像
    const myAvatarSz = 36*S
    const myAvX = padX + 10*S, myAvY = myBarY + (myBarH - myAvatarSz)/2
    const myAvBg = new PIXI.Graphics()
    myAvBg.beginFill(0xffffff, 0.08)
    myAvBg.drawCircle(myAvX + myAvatarSz/2, myAvY + myAvatarSz/2, myAvatarSz/2)
    myAvBg.endFill()
    myAvBg.lineStyle(1.5*S, 0xd4af37, 0.5)
    myAvBg.drawCircle(myAvX + myAvatarSz/2, myAvY + myAvatarSz/2, myAvatarSz/2)
    scene.addChild(myAvBg)
    const myNick = g.storage.userInfo ? g.storage.userInfo.nickName : '我'
    const myNickText = PR.createText(myNick, { fontSize: 13*S, fill: '#f0dca0', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
    myNickText.position.set(myAvX + myAvatarSz + 8*S, myBarY + 22*S)
    scene.addChild(myNickText)
    const myRankText = PR.createText(myRank > 0 ? `第 ${myRank} 名` : '未上榜', { fontSize: 11*S, fill: myRank > 0 ? 'rgba(200,200,210,0.7)' : 'rgba(140,140,160,0.5)', anchor: { x: 0, y: 0.5 } })
    myRankText.position.set(myAvX + myAvatarSz + 8*S, myBarY + 40*S)
    scene.addChild(myRankText)
    // 右侧数值
    if (tab === 'all') {
      const myFloor = PR.createText(`${g.storage.bestFloor}`, { fontSize: 22*S, fill: '#ffd700', fontWeight: 'bold', anchor: { x: 1, y: 0.5 } })
      myFloor.position.set(W - padX - 30*S, myBarY + 24*S)
      scene.addChild(myFloor)
      const myUnit = PR.createText('层', { fontSize: 10*S, fill: 'rgba(140,140,160,0.5)', anchor: { x: 1, y: 0.5 } })
      myUnit.position.set(W - padX - 14*S, myBarY + 24*S)
      scene.addChild(myUnit)
      const myBestTurns = g.storage.stats.bestTotalTurns || 0
      if (myBestTurns > 0) {
        const myTurns = PR.createText(`${myBestTurns}回合`, { fontSize: 11*S, fill: 'rgba(240,220,160,0.7)', anchor: { x: 1, y: 0.5 } })
        myTurns.position.set(W - padX - 14*S, myBarY + 42*S)
        scene.addChild(myTurns)
      }
    } else if (tab === 'dex') {
      const myDex = PR.createText(`${(g.storage.petDex||[]).length}`, { fontSize: 22*S, fill: '#4dcc4d', fontWeight: 'bold', anchor: { x: 1, y: 0.5 } })
      myDex.position.set(W - padX - 38*S, myBarY + 34*S)
      scene.addChild(myDex)
      const myDexUnit = PR.createText('/100', { fontSize: 10*S, fill: 'rgba(140,140,160,0.5)', anchor: { x: 1, y: 0.5 } })
      myDexUnit.position.set(W - padX - 14*S, myBarY + 34*S)
      scene.addChild(myDexUnit)
    } else if (tab === 'combo') {
      const myCombo = PR.createText(`${g.storage.stats.maxCombo||0}`, { fontSize: 22*S, fill: '#ff6b6b', fontWeight: 'bold', anchor: { x: 1, y: 0.5 } })
      myCombo.position.set(W - padX - 46*S, myBarY + 34*S)
      scene.addChild(myCombo)
      const myComboUnit = PR.createText('连击', { fontSize: 10*S, fill: 'rgba(140,140,160,0.5)', anchor: { x: 1, y: 0.5 } })
      myComboUnit.position.set(W - padX - 14*S, myBarY + 34*S)
      scene.addChild(myComboUnit)
    }

    scene.addChild(PR.createBackBtn(g))
  },
})

// ===== Reward 场景（PixiJS原生）=====
registerScene('reward', {
  _built: false,
  _lastKey: '',
  build(g) { this._built = true },
  update(g) {
    const scene = SceneManager.getScene('reward')
    if (!scene) return
    const key = `${g.selectedReward}_${(g.rewards||[]).length}_${g.lastSpeedKill}_${g.bState}`
    if (this._lastKey === key) return
    this._lastKey = key
    scene.removeChildren()
    const { ATTR_COLOR, ATTR_NAME, REWARD_TYPES } = require('./data/tower')
    const { getPetAvatarPath, MAX_STAR, petHasSkill, getPetSkillDesc } = require('./data/pets')

    scene.addChild(PR.createSceneBg({ bgImage: 'assets/backgrounds/reward_bg.jpg', overlay: '#000000', overlayAlpha: 0.25 }))

    const evtType = g.curEvent ? g.curEvent.type : ''
    let title = '战斗胜利 - 选择奖励'
    if (evtType === 'elite') title = '精英击败 - 选择灵兽'
    else if (evtType === 'boss') title = 'BOSS击败 - 选择奖励'
    const titleBaseY = safeTop + 42*S
    const titleText = PR.createText(title, { fontSize: 18*S, fill: '#f0e0c0', fontWeight: 'bold', anchor: 0.5, stroke: '#000000', strokeThickness: 3*S })
    titleText.position.set(W*0.5, titleBaseY)
    scene.addChild(titleText)
    // 分割线
    const divLine = new PIXI.Graphics()
    divLine.lineStyle(1*S, 0xd4af37, 0.35)
    divLine.moveTo(W*0.5 - W*0.36, titleBaseY + 14*S)
    divLine.lineTo(W*0.5 + W*0.36, titleBaseY + 14*S)
    scene.addChild(divLine)

    let headerOffset = 0
    if (g.lastSpeedKill) {
      const speedText = PR.createText(`⚡ 速通达成 (${g.lastTurnCount}回合) — 额外选项已解锁`, { fontSize: 12*S, fill: '#e8a840', anchor: 0.5 })
      speedText.position.set(W*0.5, titleBaseY + 30*S)
      scene.addChild(speedText)
      headerOffset = 22*S
    }
    if (!g.rewards) return
    const rewardCount = g.rewards.length
    const isPetOrWeapon = g.rewards.some(rw => rw.type === REWARD_TYPES.NEW_PET || rw.type === REWARD_TYPES.NEW_WEAPON)
    const maxCardArea = H * 0.58
    const gap = 10*S
    const defaultCardH = isPetOrWeapon ? 120*S : 78*S
    const cardH2 = Math.min(defaultCardH, (maxCardArea - (rewardCount-1)*gap) / rewardCount)
    const cardW2 = W*0.88
    const cardX = (W - cardW2)/2
    const startY = H*0.20 + headerOffset
    g._rewardRects = []

    g.rewards.forEach((rw, i) => {
      const cy = startY + i*(cardH2+gap)
      const selected = g.selectedReward === i
      const isSpeedBuff = rw.isSpeed === true
      // 卡片背景
      let bgAlpha = 0.92
      let bgColorInt = 0x161626
      let borderColorInt = selected ? 0xffd700 : 0x3c3c5a
      if (isSpeedBuff) { bgColorInt = selected ? 0x3d3420 : 0x1a1810 }
      else if (rw.type === REWARD_TYPES.NEW_PET && rw.data) {
        const ac = ATTR_COLOR[rw.data.attr]
        bgColorInt = ac ? PR.colorToInt(ac.bg) : 0x161626
        if (selected && ac) borderColorInt = PR.colorToInt(ac.main)
      }
      else if (rw.type === REWARD_TYPES.NEW_WEAPON) { bgColorInt = selected ? 0x3d3420 : 0x1a1810 }
      else if (rw.type === REWARD_TYPES.BUFF) { bgColorInt = selected ? 0x1a2533 : 0x141822 }

      // 尝试用reward_card_bg图片
      const cardBgTex = AssetManager.getTexture('assets/ui/reward_card_bg.png')
      if (cardBgTex) {
        const cardSprite = new PIXI.Sprite(cardBgTex)
        cardSprite.position.set(cardX, cy)
        cardSprite.width = cardW2
        cardSprite.height = cardH2
        scene.addChild(cardSprite)
        if (selected) {
          const selBorder = new PIXI.Graphics()
          selBorder.lineStyle(2.5*S, borderColorInt)
          selBorder.drawRoundedRect(cardX, cy, cardW2, cardH2, 10*S)
          scene.addChild(selBorder)
        }
      } else {
        const cardBg = new PIXI.Graphics()
        cardBg.beginFill(bgColorInt, bgAlpha)
        cardBg.drawRoundedRect(cardX, cy, cardW2, cardH2, 10*S)
        cardBg.endFill()
        cardBg.lineStyle(selected ? 2.5*S : 1.5*S, borderColorInt, selected ? 1 : 0.4)
        cardBg.drawRoundedRect(cardX, cy, cardW2, cardH2, 10*S)
        scene.addChild(cardBg)
      }

      if (rw.type === REWARD_TYPES.NEW_PET && rw.data) {
        const p = rw.data
        const ac = ATTR_COLOR[p.attr]
        const avSz = Math.min(56*S, cardH2 - 16*S)
        const avX = cardX + 12*S, avY = cy + (cardH2 - avSz)/2
        // 头像背景
        const avBg = new PIXI.Graphics()
        avBg.beginFill(ac ? PR.colorToInt(ac.bg) : 0x1a1a2e)
        avBg.drawRoundedRect(avX, avY, avSz, avSz, 6*S)
        avBg.endFill()
        scene.addChild(avBg)
        // 头像图
        const petAvSprite = PR.createSprite(getPetAvatarPath(p))
        petAvSprite.position.set(avX+1, avY+1)
        petAvSprite.width = avSz-2
        petAvSprite.height = avSz-2
        const petAvMask = new PIXI.Graphics()
        petAvMask.beginFill(0xffffff)
        petAvMask.drawRoundedRect(avX+1, avY+1, avSz-2, avSz-2, 5*S)
        petAvMask.endFill()
        scene.addChild(petAvMask)
        petAvSprite.mask = petAvMask
        scene.addChild(petAvSprite)
        // 头像框
        const framePath = `assets/ui/frame_pet_${p.attr}.png`
        const frameTex = AssetManager.getTexture(framePath)
        if (frameTex) {
          const fScale = 1.12, fSz = avSz*fScale, fOff = (fSz-avSz)/2
          const frameSprite = new PIXI.Sprite(frameTex)
          frameSprite.position.set(avX-fOff, avY-fOff)
          frameSprite.width = fSz
          frameSprite.height = fSz
          scene.addChild(frameSprite)
        }
        // 右侧信息
        const infoX = avX + avSz + 14*S
        let iy = cy + 16*S
        const petName = PR.createText(p.name, { fontSize: 14*S, fill: ac ? ac.main : '#eeeeee', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
        petName.position.set(infoX, iy)
        scene.addChild(petName)
        iy += 18*S
        const atkText = PR.createText(`ATK: ${p.atk}    CD: ${p.cd}回合`, { fontSize: 11*S, fill: 'rgba(200,200,210,0.7)', anchor: { x: 0, y: 0.5 } })
        atkText.position.set(infoX, iy)
        scene.addChild(atkText)
        // 已拥有
        const allOwned = [...(g.pets||[]), ...(g.petBag||[])]
        const ownedPet = allOwned.find(op => op.id === p.id)
        if (ownedPet) {
          iy += 16*S
          const ownedStar = ownedPet.star || 1
          const starDisp = '★'.repeat(ownedStar) + (ownedStar < MAX_STAR ? '☆'.repeat(MAX_STAR - ownedStar) : '')
          const ownText = ownedStar >= MAX_STAR
            ? `已拥有 ${starDisp}（已满星）`
            : `已拥有 ${starDisp}　选择则升至${ownedStar+1}星`
          const ownLabel = PR.createText(ownText, { fontSize: 11*S, fill: ownedStar >= MAX_STAR ? '#C07000' : '#27864A', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
          ownLabel.position.set(infoX, iy)
          scene.addChild(ownLabel)
        }
        // 技能
        if (p.skill) {
          iy += 18*S
          if (petHasSkill(p)) {
            const skillName = PR.createText(`技能：${p.skill.name}`, { fontSize: 11*S, fill: '#e0c070', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
            skillName.position.set(infoX, iy)
            scene.addChild(skillName)
            iy += 16*S
            const descStr = getPetSkillDesc(p)
            const skillDesc = PR.createText(descStr, { fontSize: 10*S, fill: 'rgba(140,140,160,0.5)', anchor: { x: 0, y: 0 }, wordWrap: true, wordWrapWidth: cardW2 - (infoX - cardX) - 10*S })
            skillDesc.position.set(infoX, iy)
            scene.addChild(skillDesc)
          } else {
            const noSkill = PR.createText('技能：升至★2解锁', { fontSize: 11*S, fill: '#8B7B70', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
            noSkill.position.set(infoX, iy)
            scene.addChild(noSkill)
          }
        }
      } else if (rw.type === REWARD_TYPES.NEW_WEAPON && rw.data) {
        const w2 = rw.data
        const avSz = Math.min(56*S, cardH2 - 16*S)
        const avX = cardX + 12*S, avY = cy + (cardH2 - avSz)/2
        const wpnBg = new PIXI.Graphics()
        wpnBg.beginFill(0x2a2030)
        wpnBg.drawRoundedRect(avX, avY, avSz, avSz, 6*S)
        wpnBg.endFill()
        scene.addChild(wpnBg)
        const wpnSprite = PR.createSprite(`assets/equipment/fabao_${w2.id}.png`)
        wpnSprite.position.set(avX+1, avY+1)
        wpnSprite.width = avSz-2
        wpnSprite.height = avSz-2
        const wpnMask = new PIXI.Graphics()
        wpnMask.beginFill(0xffffff)
        wpnMask.drawRoundedRect(avX+1, avY+1, avSz-2, avSz-2, 5*S)
        wpnMask.endFill()
        scene.addChild(wpnMask)
        wpnSprite.mask = wpnMask
        scene.addChild(wpnSprite)
        const infoX = avX + avSz + 14*S
        let iy = cy + 18*S
        const wpnName = PR.createText(`法宝·${w2.name}`, { fontSize: 14*S, fill: '#e0a020', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
        wpnName.position.set(infoX, iy)
        scene.addChild(wpnName)
        if (w2.desc) {
          iy += 20*S
          const wpnDesc = PR.createText(w2.desc, { fontSize: 11*S, fill: 'rgba(200,200,210,0.7)', anchor: { x: 0, y: 0 }, wordWrap: true, wordWrapWidth: cardW2 - (infoX - cardX) - 10*S })
          wpnDesc.position.set(infoX, iy)
          scene.addChild(wpnDesc)
        }
      } else {
        // Buff卡片
        const iconSz = Math.min(48*S, cardH2 - 10*S)
        const iconX = cardX + 14*S, iconY = cy + (cardH2 - iconSz)/2
        // buff图标
        const BUFF_ICON_IMGS = {
          allAtkPct:'buff_icon_atk', allDmgPct:'buff_icon_atk', counterDmgPct:'buff_icon_atk', skillDmgPct:'buff_icon_atk',
          healNow:'buff_icon_heal', postBattleHeal:'buff_icon_heal', regenPerTurn:'buff_icon_heal',
          dmgReducePct:'buff_icon_def', nextDmgReduce:'buff_icon_def', grantShield:'buff_icon_def', immuneOnce:'buff_icon_def',
          comboDmgPct:'buff_icon_elim', elim3DmgPct:'buff_icon_elim', elim4DmgPct:'buff_icon_elim', elim5DmgPct:'buff_icon_elim', bonusCombo:'buff_icon_elim',
          extraTimeSec:'buff_icon_time', skillCdReducePct:'buff_icon_time', resetAllCd:'buff_icon_time',
          hpMaxPct:'buff_icon_hp',
          enemyAtkReducePct:'buff_icon_weaken', enemyHpReducePct:'buff_icon_weaken', eliteAtkReducePct:'buff_icon_weaken',
          eliteHpReducePct:'buff_icon_weaken', bossAtkReducePct:'buff_icon_weaken', bossHpReducePct:'buff_icon_weaken',
          nextStunEnemy:'buff_icon_weaken', stunDurBonus:'buff_icon_weaken',
          extraRevive:'buff_icon_special', skipNextBattle:'buff_icon_special', nextFirstTurnDouble:'buff_icon_special', heartBoostPct:'buff_icon_special',
        }
        const buffKey = (rw.data || {}).buff || ''
        const iconImgName = BUFF_ICON_IMGS[buffKey]
        if (iconImgName) {
          const icoSprite = PR.createSprite(`assets/ui/${iconImgName}.png`)
          icoSprite.position.set(iconX, iconY)
          icoSprite.width = iconSz
          icoSprite.height = iconSz
          scene.addChild(icoSprite)
        }
        const textX = iconX + iconSz + 10*S
        const typeTag = isSpeedBuff ? '⚡速通' : '加成'
        const tagLabel = PR.createText(typeTag, { fontSize: 10*S, fill: isSpeedBuff ? '#e0c070' : '#8ab4d8', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
        tagLabel.position.set(textX, cy + cardH2*0.38)
        scene.addChild(tagLabel)
        const buffName = PR.createText(rw.label, { fontSize: 13*S, fill: '#f0e0c0', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
        buffName.position.set(textX, cy + cardH2*0.62)
        scene.addChild(buffName)
        const buffHint = PR.createText('全队永久生效', { fontSize: 9*S, fill: '#999999', anchor: { x: 0, y: 0.5 } })
        buffHint.position.set(textX, cy + cardH2*0.85)
        scene.addChild(buffHint)
      }
      g._rewardRects.push([cardX, cy, cardW2, cardH2])
    })

    // 确认按钮
    if (g.selectedReward >= 0) {
      const bx = W*0.25, by = H*0.86, bw = W*0.5, bh = 44*S
      const confirmBtnTex = AssetManager.getTexture('assets/ui/btn_reward_confirm.png')
      if (confirmBtnTex) {
        const confirmSprite = new PIXI.Sprite(confirmBtnTex)
        confirmSprite.position.set(bx, by)
        confirmSprite.width = bw
        confirmSprite.height = bh
        scene.addChild(confirmSprite)
        const confirmLabel = PR.createText('确认', { fontSize: 16*S, fill: '#4A2020', fontWeight: 'bold', anchor: 0.5 })
        confirmLabel.position.set(bx + bw*0.5, by + bh*0.48)
        scene.addChild(confirmLabel)
      } else {
        const confirmBtn = PR.createButton({ x: bx, y: by, w: bw, h: bh, text: '确认', color: '#ffd700' })
        scene.addChild(confirmBtn)
      }
      g._rewardConfirmRect = [bx, by, bw, bh]
    }
    if (g.bState !== 'victory') {
      scene.addChild(PR.createBackBtn(g))
    } else {
      g._backBtnRect = null
    }
  },
})

// ===== Dex（灵兽图鉴）场景（PixiJS原生）=====
registerScene('dex', {
  _built: false,
  _lastKey: '',
  build(g) { this._built = true },
  update(g) {
    const scene = SceneManager.getScene('dex')
    if (!scene) return
    const _dex = g.storage.petDex || []
    const key = `${_dex.length}_${Math.round(g._dexScrollY||0)}_${g._dexDetailPetId||''}`
    if (this._lastKey === key) return
    this._lastKey = key
    scene.removeChildren()
    const { ATTR_COLOR } = require('./data/tower')
    const { PETS, getPetAvatarPath, MAX_STAR, getPetSkillDesc, getPetLore, getPetStarAtk } = require('./data/pets')
    const DEX_ATTRS = ['metal','wood','water','fire','earth']
    const DEX_ATTR_LABEL = { metal:'金', wood:'木', water:'水', fire:'火', earth:'土' }

    scene.addChild(PR.createSceneBg({ bgImage: 'assets/backgrounds/home_bg.jpg', overlay: '#000000', overlayAlpha: 0.45 }))
    scene.addChild(PR.createTitleHeader('灵兽图鉴'))

    const dex = g.storage.petDex || []
    const totalPets = DEX_ATTRS.reduce((sum, a) => sum + PETS[a].length, 0)
    const collectLabel = PR.createText(`已收集：${dex.length} / ${totalPets}`, { fontSize: 12*S, fill: 'rgba(200,200,210,0.7)', anchor: 0.5 })
    collectLabel.position.set(W*0.5, safeTop + 64*S)
    scene.addChild(collectLabel)

    // 提示条
    const tipY = safeTop + 74*S, tipH = 36*S, tipPadX = 14*S
    const tipBg = new PIXI.Graphics()
    tipBg.beginFill(0xffebcc, 0.12)
    tipBg.drawRoundedRect(tipPadX, tipY, W-tipPadX*2, tipH, 6*S)
    tipBg.endFill()
    tipBg.lineStyle(1*S, 0xd4af37, 0.25)
    tipBg.drawRoundedRect(tipPadX, tipY, W-tipPadX*2, tipH, 6*S)
    scene.addChild(tipBg)
    const tip1 = PR.createText('💡 点击已收集灵兽可选择「带它出战」', { fontSize: 10*S, fill: '#ffd54f', fontWeight: 'bold', anchor: 0.5 })
    tip1.position.set(W*0.5, tipY + 13*S)
    scene.addChild(tip1)
    const tip2 = PR.createText('收集规则：灵兽在冒险中升至满星（★★★）即永久录入图鉴', { fontSize: 8.5*S, fill: 'rgba(245,230,200,0.65)', anchor: 0.5 })
    tip2.position.set(W*0.5, tipY + 28*S)
    scene.addChild(tip2)

    // 滚动区域
    const contentTop = safeTop + 74*S + tipH + 6*S
    const contentBottom = H - 8*S
    const scrollY = g._dexScrollY || 0

    const scrollContainer = new PIXI.Container()
    const scrollMask = new PIXI.Graphics()
    scrollMask.beginFill(0xffffff)
    scrollMask.drawRect(0, contentTop, W, contentBottom - contentTop)
    scrollMask.endFill()
    scene.addChild(scrollMask)
    scrollContainer.mask = scrollMask
    scene.addChild(scrollContainer)

    const padX = 12*S, cols = 5
    const cellGap = 4*S
    const cellW = (W - padX*2 - (cols-1)*cellGap) / cols
    const cellH = cellW + 18*S
    let y = contentTop + scrollY
    g._dexTotalH = 0
    g._dexCellRects = []

    for (const attr of DEX_ATTRS) {
      const pets = PETS[attr]
      const ac = ATTR_COLOR[attr]
      const attrLabel = PR.createText(`${DEX_ATTR_LABEL[attr]}属性 (${pets.filter(p=>dex.includes(p.id)).length}/${pets.length})`, { fontSize: 14*S, fill: ac.main, fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
      attrLabel.position.set(padX, y + 10*S)
      scrollContainer.addChild(attrLabel)
      y += 22*S

      const rows = Math.ceil(pets.length / cols)
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r*cols + c
          if (idx >= pets.length) break
          const pet = pets[idx]
          const cx = padX + c*(cellW+cellGap)
          const cy2 = y + r*(cellH+cellGap)
          const collected = dex.includes(pet.id)
          // 卡片背景
          const cellBg = new PIXI.Graphics()
          cellBg.beginFill(collected ? 0xffffff : 0x000000, collected ? 0.08 : 0.2)
          cellBg.drawRoundedRect(cx, cy2, cellW, cellH, 4*S)
          cellBg.endFill()
          scrollContainer.addChild(cellBg)
          if (collected) {
            // 头像
            const fakePet = { id: pet.id, star: MAX_STAR }
            const imgPad = 3*S, imgSz = cellW - imgPad*2
            const avSprite = PR.createSprite(getPetAvatarPath(fakePet))
            avSprite.position.set(cx+imgPad, cy2+imgPad)
            avSprite.width = imgSz
            avSprite.height = imgSz
            const avMask = new PIXI.Graphics()
            avMask.beginFill(0xffffff)
            avMask.drawRoundedRect(cx+imgPad, cy2+imgPad, imgSz, imgSz, 3*S)
            avMask.endFill()
            scrollContainer.addChild(avMask)
            avSprite.mask = avMask
            scrollContainer.addChild(avSprite)
            // 边框
            const border = new PIXI.Graphics()
            border.lineStyle(1*S, PR.colorToInt(ac.main), 0.53)
            border.drawRoundedRect(cx, cy2, cellW, cellH, 4*S)
            scrollContainer.addChild(border)
            // 名字
            const shortName = pet.name.length > 4 ? pet.name.substring(0,4) : pet.name
            const petNameTxt = PR.createText(shortName, { fontSize: 8*S, fill: ac.lt, anchor: 0.5 })
            petNameTxt.position.set(cx + cellW/2, cy2 + cellW - imgPad + 14*S)
            scrollContainer.addChild(petNameTxt)
            // 点击区域
            if (cy2 + cellH > contentTop && cy2 < contentBottom) {
              g._dexCellRects.push({ id: pet.id, attr: attr, x: cx, y: cy2, w: cellW, h: cellH })
            }
            // 新获得红点
            const seen = g.storage.petDexSeen
            if (!seen.includes(pet.id)) {
              const dotR = 4*S
              const dot = new PIXI.Graphics()
              dot.beginFill(0xe04040)
              dot.drawCircle(cx + cellW - imgPad - dotR + 2*S, cy2 + imgPad + dotR - 2*S, dotR)
              dot.endFill()
              dot.lineStyle(1*S, 0xffffff)
              dot.drawCircle(cx + cellW - imgPad - dotR + 2*S, cy2 + imgPad + dotR - 2*S, dotR)
              scrollContainer.addChild(dot)
            }
          } else {
            // 问号
            const qBg = new PIXI.Graphics()
            qBg.beginFill(0xffffff, 0.08)
            qBg.drawCircle(cx + cellW/2, cy2 + cellW*0.4, cellW*0.25)
            qBg.endFill()
            scrollContainer.addChild(qBg)
            const qMark = PR.createText('?', { fontSize: 18*S, fill: 'rgba(140,140,160,0.5)', fontWeight: 'bold', anchor: 0.5 })
            qMark.position.set(cx + cellW/2, cy2 + cellW*0.4)
            scrollContainer.addChild(qMark)
            const unkName = PR.createText('???', { fontSize: 8*S, fill: 'rgba(255,255,255,0.15)', anchor: 0.5 })
            unkName.position.set(cx + cellW/2, cy2 + cellW + 10*S)
            scrollContainer.addChild(unkName)
          }
        }
      }
      y += rows*(cellH+cellGap) + 8*S
    }
    g._dexTotalH = y - scrollY - contentTop

    scene.addChild(PR.createBackBtn(g))

    // 宠物详情弹窗
    if (g._dexDetailPetId) {
      _drawDexPetDetailPixi(g, scene, ATTR_COLOR, PETS, DEX_ATTRS, getPetAvatarPath, MAX_STAR, getPetSkillDesc, getPetLore, getPetStarAtk)
    }
  },
})

/** 图鉴宠物详情弹窗（PixiJS原生） */
function _drawDexPetDetailPixi(g, scene, ATTR_COLOR, PETS, DEX_ATTRS, getPetAvatarPath, MAX_STAR, getPetSkillDesc, getPetLore, getPetStarAtk) {
  const petId = g._dexDetailPetId
  let pet = null, petAttr = ''
  for (const attr of DEX_ATTRS) {
    const found = PETS[attr].find(p => p.id === petId)
    if (found) { pet = found; petAttr = attr; break }
  }
  if (!pet) { g._dexDetailPetId = null; return }
  const ac = ATTR_COLOR[petAttr]
  const curStar = MAX_STAR
  const fakePet = { id: petId, star: curStar, attr: petAttr, skill: pet.skill, atk: pet.atk, cd: pet.cd }
  const curAtk = getPetStarAtk(fakePet)
  const skillDesc = getPetSkillDesc(fakePet) || pet.skill.desc
  const lore = getPetLore(petId)

  // 遮罩
  const overlay = PR.createOverlay(0.6)
  scene.addChild(overlay)

  // 面板
  const panelW = W*0.88, panelX = (W - panelW)/2
  const pad = 14*S
  const imgSize = Math.min(panelW*0.48, H*0.28)
  const panelH = Math.min(H*0.85, pad + imgSize + 200*S)
  const panelY = Math.max(safeTop + 5*S, (H - panelH)/2)
  const panel = PR.createInfoPanel(panelX, panelY, panelW, panelH, 14*S)
  scene.addChild(panel)
  g._dexDetailRect = [panelX, panelY, panelW, panelH]

  let curY = panelY + pad
  // 大图
  const imgX = (W - imgSize)/2
  const avSprite = PR.createSprite(getPetAvatarPath(fakePet))
  avSprite.position.set(imgX, curY)
  avSprite.width = imgSize
  avSprite.height = imgSize
  const avMask = new PIXI.Graphics()
  avMask.beginFill(0xffffff)
  avMask.drawRoundedRect(imgX, curY, imgSize, imgSize, 8*S)
  avMask.endFill()
  scene.addChild(avMask)
  avSprite.mask = avMask
  scene.addChild(avSprite)
  curY += imgSize + 6*S

  // 名称+星星
  const starStr = '★'.repeat(curStar)
  const nameLabel = PR.createText(`${pet.name}  ${starStr}`, { fontSize: 14*S, fill: '#3D2B1F', fontWeight: 'bold', anchor: 0.5 })
  nameLabel.position.set(W*0.5, curY + 10*S)
  scene.addChild(nameLabel)
  curY += 22*S

  // ATK
  const atkLabel = PR.createText(`ATK：${curAtk}`, { fontSize: 11*S, fill: '#6B5B50', anchor: 0.5 })
  atkLabel.position.set(W*0.5, curY + 8*S)
  scene.addChild(atkLabel)
  curY += 20*S

  // 技能
  const skillTitle = PR.createText(`技能：${pet.skill.name}  CD ${pet.cd}`, { fontSize: 11*S, fill: '#7A5C30', fontWeight: 'bold', anchor: { x: 0, y: 0 } })
  skillTitle.position.set(panelX + pad, curY)
  scene.addChild(skillTitle)
  curY += 16*S
  const skillDescLabel = PR.createText(skillDesc, { fontSize: 10*S, fill: '#5C4A3A', anchor: { x: 0, y: 0 }, wordWrap: true, wordWrapWidth: panelW - pad*2 - 8*S })
  skillDescLabel.position.set(panelX + pad + 4*S, curY)
  scene.addChild(skillDescLabel)
  curY += skillDescLabel.height + 8*S

  // 分割线
  const sepLine = new PIXI.Graphics()
  sepLine.lineStyle(1*S, 0xa08c64, 0.25)
  sepLine.moveTo(panelX + pad, curY)
  sepLine.lineTo(panelX + panelW - pad, curY)
  scene.addChild(sepLine)
  curY += 8*S

  // 故事
  const loreTxt = PR.createText(lore || '', { fontSize: 11*S, fill: '#5C4A3A', anchor: { x: 0, y: 0 }, wordWrap: true, wordWrapWidth: panelW - pad*2 })
  loreTxt.position.set(panelX + pad, curY)
  scene.addChild(loreTxt)
  curY += loreTxt.height + 10*S

  // 带它出战按钮
  const btnW = panelW*0.6, btnH = 34*S
  const btnX = (W - btnW)/2
  const btnBg = new PIXI.Graphics()
  btnBg.beginFill(0xd4a840)
  btnBg.drawRoundedRect(btnX, curY, btnW, btnH, 8*S)
  btnBg.endFill()
  scene.addChild(btnBg)
  const btnLabel = PR.createText('带它出战（1星）', { fontSize: 11*S, fill: '#ffffff', fontWeight: 'bold', anchor: 0.5 })
  btnLabel.position.set(W*0.5, curY + btnH*0.5)
  scene.addChild(btnLabel)
  g._dexBattleBtnRect = [btnX, curY, btnW, btnH]

  // 关闭提示
  const closeHint = PR.createText('点击其他区域关闭', { fontSize: 9*S, fill: '#9B8B80', anchor: 0.5 })
  closeHint.position.set(W*0.5, panelY + panelH - 8*S)
  scene.addChild(closeHint)
}

// ===== Prepare 场景（PixiJS 原生，独立模块） =====
registerScene('prepare', createPrepareBuilder({ SceneManager, PR, W, H, S, safeTop }))

// ===== Event 场景（PixiJS 原生，独立模块） =====
const { createEventBuilder } = require('./pixi/eventScene')
registerScene('event', createEventBuilder({ SceneManager, PR, W, H, S, safeTop }))

// ===== Battle 场景（PixiJS 原生，独立模块） =====
const { createBattleBuilder } = require('./pixi/battleScene')
registerScene('battle', createBattleBuilder({ SceneManager, PR, W, H, S, safeTop, COLS, ROWS }))

// ===== 全局覆盖层（宠物获得弹窗、★3庆祝） =====
const _overlayRenderer = createOverlayRenderer({ SceneManager, PR, W, H, S })

// ===== 全局特效层（飘字、技能特效等）—— 对象池优化 =====
const { FramePool: _EffectPool } = require('./pixi/ObjectPool')
let _effectFP = null  // 特效层 FramePool
registerScene('_effects', {
  _built: false,
  build(g) { this._built = true },
  update(g) {
    const effectLayer = SceneManager.effectLayer
    if (!effectLayer) return
    if (!_effectFP) _effectFP = new _EffectPool(effectLayer, { PR, AssetManager, S })
    _effectFP.reset()

    // 飘字特效
    g.dmgFloats.forEach(f => {
      const t = _effectFP.txt(f.text, {
        fontSize: (22 * (f.scale || 1)) * S, fill: f.color || TH.danger, fontWeight: 'bold',
        anchor: 0.5, stroke: '#000000', strokeThickness: 3.5 * S,
      })
      t.position.set(f.x, f.y); t.alpha = f.alpha || 1
    })

    // 技能特效文字
    g.skillEffects.forEach(e => {
      const sz = e.big ? 28 : 16, sc = e.scale || 1
      const t = _effectFP.txt(e.text, {
        fontSize: sz * sc * S, fill: e.color || TH.accent, fontWeight: 'bold',
        anchor: 0.5, stroke: '#000000', strokeThickness: (e.big ? 4 : 3) * S,
      })
      t.position.set(e.x, e.y); t.alpha = e.alpha || 1
      if (e.desc) {
        const d = _effectFP.txt(e.desc, {
          fontSize: (e.big ? 13 : 10) * S, fill: '#ffe0aa', fontWeight: 'bold',
          anchor: 0.5, stroke: '#000000', strokeThickness: 2.5 * S,
        })
        d.position.set(e.x, e.y + sz * 0.5 * S + 12 * S); d.alpha = e.alpha || 1
      }
    })

    // 消除飘字
    g.elimFloats.forEach(f => {
      const t = _effectFP.txt(f.text, {
        fontSize: (18 * (f.scale || 1)) * S, fill: f.color || '#ffffff', fontWeight: 'bold',
        anchor: 0.5, stroke: '#000000', strokeThickness: 3 * S,
      })
      t.position.set(f.x, f.y); t.alpha = f.alpha || 1
      if (f.subText) {
        const sub = _effectFP.txt(f.subText, {
          fontSize: 11 * S, fill: '#ffd700', fontWeight: 'bold',
          anchor: 0.5, stroke: '#000000', strokeThickness: 2.5 * S,
        })
        sub.position.set(f.x, f.y + (18 * (f.scale || 1)) * S * 0.7); sub.alpha = f.alpha || 1
      }
    })

    // 宠物攻击数值
    g.petAtkNums.forEach(f => {
      const t = _effectFP.txt(f.text, {
        fontSize: (16 * (f.scale || 1)) * S, fill: f.color || '#ffd700', fontWeight: 'bold',
        anchor: { x: f.isHeal ? 1 : 0.5, y: f.isHeal ? 0.5 : 1 }, stroke: '#000000', strokeThickness: 3 * S,
      })
      t.position.set(f.x, f.y); t.alpha = f.alpha || 1
    })

    _effectFP.hideUnused()
  },
})


class Main {
  constructor() {
    this.storage = new Storage()
    this._scene = null
    this.scene = 'loading'
    this.af = 0

    // 棋盘
    this.board = []; this.cellSize = 0; this.boardX = 0; this.boardY = 0
    // 转珠
    this.dragging = false
    this.dragR = -1; this.dragC = -1
    this.dragStartX = 0; this.dragStartY = 0
    this.dragCurX = 0; this.dragCurY = 0
    this.dragAttr = null
    this.dragTimer = 0
    this.dragTimeLimit = 8 * 60
    // 交换动画
    this.swapAnim = null
    // 战斗状态
    this.bState = 'none'
    this._stateTimer = 0
    this._enemyTurnWait = false
    this._pendingEnemyAtk = null
    this._pendingDmgMap = null
    this._pendingHeal = 0
    this.combo = 0; this.turnCount = 0
    this.elimQueue = []
    this.elimAnimCells = null; this.elimAnimTimer = 0
    this.dropAnimTimer = 0; this.dropAnimCols = null
    // 动画
    this.dmgFloats = []; this.skillEffects = []
    this.elimFloats = []
    this.petAtkNums = []
    this._comboAnim = { num: 0, timer: 0, scale: 1 }
    this._comboParticles = []
    this._comboFlash = 0
    this._petFinalDmg = {}
    this._petAtkRollTimer = 0
    this.shakeT = 0; this.shakeI = 0
    this.heroAttackAnim = { active: false, progress: 0, duration: 24 }
    this.enemyHurtAnim = { active: false, progress: 0, duration: 18 }
    this.heroHurtAnim = { active: false, progress: 0, duration: 18 }
    this.enemyAttackAnim = { active: false, progress: 0, duration: 20 }
    this.skillCastAnim = { active: false, progress: 0, duration: 30, type: 'slash', color: TH.accent, skillName: '', targetX: 0, targetY: 0 }
    this._enemyHpLoss = null; this._heroHpLoss = null; this._heroHpGain = null
    this._enemyHitFlash = 0
    this._enemyDeathAnim = null
    this._blockFlash = 0
    this._heroHurtFlash = 0
    this._enemyWarning = 0
    this._counterFlash = null
    this._bossEntrance = 0

    // Run state (Roguelike)
    this.floor = 0
    this.pets = []
    this.weapon = null
    this.petBag = []
    this.weaponBag = []
    this.heroHp = 0; this.heroMaxHp = 60
    this.heroShield = 0
    this.heroBuffs = []; this.enemyBuffs = []
    this.enemy = null
    this.curEvent = null
    this.rewards = null
    this.shopItems = null
    this.restOpts = null
    this.adventureData = null
    this.selectedReward = -1
    this.rewardPetSlot = -1
    this.shopUsed = false
    // 战前编辑
    this.prepareTab = 'pets'
    this.prepareSelBagIdx = -1
    this.prepareSelSlotIdx = -1
    this.prepareTip = null
    this._eventPetDetail = null
    this._eventPetDetailData = null
    this._eventWpnDetail = null
    this._eventWpnDetailData = null
    this._eventDragPet = null
    this.showRunBuffDetail = false
    this.showWeaponDetail = false
    this.showBattlePetDetail = null
    this._runBuffIconRects = []
    // 局内BUFF
    this.runBuffLog = []
    this.runBuffs = runMgr.makeDefaultRunBuffs()
    this.skipNextBattle = false
    this.nextStunEnemy = false
    this.nextDmgDouble = false
    this.tempRevive = false
    this.immuneOnce = false
    this.comboNeverBreak = false
    this.weaponReviveUsed = false
    this.goodBeadsNextTurn = false

    this._loadStart = Date.now()
    this._loadReady = false
    this._loadPct = 0
    this._pressedBtn = null
    // 长按预览
    this._petLongPressTimer = null
    this._petLongPressIndex = -1
    this._petLongPressTriggered = false
    // 上划释放技能
    this._petSwipeIndex = -1
    this._petSwipeStartX = 0
    this._petSwipeStartY = 0
    this._petSwipeTriggered = false
    this.skillPreview = null
    this.showExitDialog = false
    this.showNewRunConfirm = false
    // 排行榜
    this.rankTab = 'all'
    this.rankScrollY = 0

    // 触摸事件
    // 始终使用 wx.onTouchXxx（坐标为 CSS 逻辑值，乘 dpr 得像素坐标）
    // 避免用 canvas.addEventListener，因为 PixiJS 可能抢注事件导致冲突
    wx.onTouchStart(e => this.onTouch('start', e))
    wx.onTouchMove(e => this.onTouch('move', e))
    wx.onTouchEnd(e => this.onTouch('end', e))

    // ===== 渲染循环 =====
    if (pixiReady) {
      // PixiJS ticker驱动
      pixiApp.ticker.add(() => {
        this.af++
        try {
          this.update()
          this.pixiRender()
        } catch (e) {
          console.error('ticker error:', e.message, e.stack)
        }
      })
      console.log('[Main] PixiJS ticker 渲染循环启动')
    } else {
      // 降级：Canvas 2D requestAnimationFrame
      const loop = () => {
        this.af++
        try {
          this.update()
          this.render()
        } catch (e) {
          console.error('loop error:', e)
        }
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
      console.log('[Main] Canvas 2D fallback 渲染循环启动')
    }

    // 微信分享
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] })
    wx.onShareAppMessage(() => this._getShareData())

    // 预加载关键图片（同时通过AssetManager和Render）
    const criticalImages = [
      'assets/backgrounds/loading_bg.jpg',
      'assets/backgrounds/home_bg.jpg',
      'assets/backgrounds/board_bg_dark1.jpg',
      'assets/backgrounds/board_bg_light1.jpg',
      'assets/ui/title_logo.png',
      'assets/ui/btn_start.png',
      'assets/ui/btn_continue.png',
      'assets/ui/btn_rank.png',
      'assets/battle/battle_metal.jpg',
      'assets/battle/battle_wood.jpg',
      'assets/battle/battle_water.jpg',
      'assets/battle/battle_fire.jpg',
      'assets/battle/battle_earth.jpg',
      'assets/orbs/orb_metal.png',
      'assets/orbs/orb_wood.png',
      'assets/orbs/orb_water.png',
      'assets/orbs/orb_fire.png',
      'assets/orbs/orb_earth.png',
      'assets/orbs/orb_heart.png',
    ]

    if (pixiReady) {
      AssetManager.preload(criticalImages, (loaded, total) => {
        this._loadPct = loaded / total
      }).then(() => {
        console.log('[Preload] PixiJS textures ready')
        this._loadReady = true
      })
    }
    // 同时通过Render预加载（供未迁移场景的离屏Canvas渲染使用）
    R.preloadImages(criticalImages, (loaded, total) => {
      if (!pixiReady) this._loadPct = loaded / total
    }).then(() => {
      if (!pixiReady) {
        console.log('[Preload] Canvas2D images ready')
        this._loadReady = true
      }
    })
  }

  // ===== Run管理 =====
  _startRun() { runMgr.startRun(this) }
  _nextFloor() { runMgr.nextFloor(this) }
  _restoreBattleHpMax() { runMgr.restoreBattleHpMax(this) }
  _endRun() { runMgr.endRun(this) }
  _saveAndExit() { runMgr.saveAndExit(this) }
  _resumeRun() { runMgr.resumeRun(this) }

  // ===== 更新 =====
  update() {
    anim.updateAnimations(this)
    if (tutorial.isActive()) {
      tutorial.update(this)
      if (this.bState === 'victory') {
        if (tutorial.onVictory(this)) return
      }
    }
    if (this.bState === 'victory' && !this.rewards && !tutorial.isActive() && this.floor < MAX_FLOOR) {
      const ownedWpnIds = new Set()
      if (this.weapon) ownedWpnIds.add(this.weapon.id)
      if (this.weaponBag) this.weaponBag.forEach(w => ownedWpnIds.add(w.id))
      const ownedPetIds = new Set()
      if (this.pets) this.pets.forEach(p => { if (p) ownedPetIds.add(p.id) })
      if (this.petBag) this.petBag.forEach(p => { if (p) ownedPetIds.add(p.id) })
      const maxedPetIds = getMaxedPetIds(this)
      this.rewards = generateRewards(this.floor, this.curEvent ? this.curEvent.type : 'battle', this.lastSpeedKill, ownedWpnIds, this.sessionPetPool, ownedPetIds, maxedPetIds)
      this.selectedReward = -1
      this._rewardDetailShow = null
    }
    if (this.scene === 'loading') {
      const elapsed = Date.now() - this._loadStart
      if (this._loadReady && elapsed > 500) {
        this.scene = 'title'; MusicMgr.playBgm()
      }
    }
    if (this.bState === 'elimAnim') this._processElim()
    if (this.bState === 'dropping') this._processDropAnim()
    if (this.dragging && this.bState === 'playerTurn') {
      this.dragTimer++
      if (this.dragTimer >= this.dragTimeLimit) {
        this.dragging = false; this.dragAttr = null; this.dragTimer = 0
        MusicMgr.playDragEnd()
        this._checkAndElim()
      }
    }
    if (this._pendingEnemyAtk && this.bState === 'playerTurn') {
      this._pendingEnemyAtk.timer++
      if (this._pendingEnemyAtk.timer >= this._pendingEnemyAtk.delay) {
        this._pendingEnemyAtk = null
        this._enemyTurn()
        if (this.bState === 'enemyTurn') {
          const stunIdx = this.heroBuffs.findIndex(b => b.type === 'heroStun')
          if (stunIdx >= 0) {
            this.heroBuffs.splice(stunIdx, 1)
            this.skillEffects.push({ x: ViewEnv.W * 0.5, y: ViewEnv.H * 0.5, text: '被眩晕！跳过操作', color: '#ff4444', t: 0, alpha: 1 })
            this._pendingEnemyAtk = { timer: 0, delay: 24 }
          }
          this.bState = 'playerTurn'
          if (tutorial.isActive()) tutorial.onEnemyTurnEnd(this)
        }
      }
    }
    if (this.bState === 'petAtkShow') {
      this._stateTimer++
      if (this._stateTimer >= 38) { this._stateTimer = 0; this.bState = 'preAttack' }
    }
    if (this.bState === 'preAttack') {
      this._stateTimer++; if (this._stateTimer >= 12) { this._stateTimer = 0; this._executeAttack() }
    }
    if (this.bState === 'preEnemy') {
      this._stateTimer++; if (this._stateTimer >= 30) { this._stateTimer = 0; this._enemyTurn() }
    }
    if (this.bState === 'enemyTurn' && this._enemyTurnWait) {
      this._stateTimer++
      if (this._stateTimer >= 30) {
        this._stateTimer = 0; this._enemyTurnWait = false
        const stunIdx = this.heroBuffs.findIndex(b => b.type === 'heroStun')
        if (stunIdx >= 0) {
          this.heroBuffs.splice(stunIdx, 1)
          this.skillEffects.push({ x: ViewEnv.W * 0.5, y: ViewEnv.H * 0.5, text: '被眩晕！跳过操作', color: '#ff4444', t: 0, alpha: 1 })
          this.bState = 'preEnemy'; this._stateTimer = 0
        } else {
          battleEngine.onPlayerTurnStart(this)
          this.bState = 'playerTurn'; this.dragTimer = 0
          if (tutorial.isActive()) tutorial.onEnemyTurnEnd(this)
        }
      }
    }
    anim.updateSwapAnim(this)
    anim.updateBattleAnims(this)
    anim.updateHpAnims(this)
    anim.updateSkillPreview(this)
    if (this.scene === 'ranking' && this.af % 7200 === 0) {
      this.storage.fetchRanking(this.rankTab, true)
    }
    this._updateTitleAuthBtn()
    this._updateFeedbackBtn()
  }

  // ===== PixiJS 渲染入口 =====
  pixiRender() {
    const sceneName = this.scene
    const builder = sceneBuilders[sceneName]
    if (builder) {
      try {
        builder.update(this)
      } catch(e) {
        if (this.af % 120 === 1) console.error(`[pixiRender] ${sceneName} error:`, e.message)
      }
    }

    // 全局特效层
    if (sceneBuilders['_effects']) {
      sceneBuilders['_effects'].update(this)
    }

    // 教学覆盖层
    if (tutorial.isActive() && this.scene === 'battle') {
      // 教学已在 battleScene.js 的 _tutorial() 中原生渲染
    }

    // 全局覆盖层（宠物获得弹窗、★3庆祝）
    _overlayRenderer.updateOverlays(this)

    // PixiJS自动render（ticker内部驱动）
    // 保险起见手动调用一次render，确保画面刷新
    try {
      pixiApp.renderer.render(pixiApp.stage)
    } catch(e) {
      if (this.af % 120 === 1) console.error('[pixiRender] manual render error:', e.message)
    }
  }

  // ===== Canvas 2D 降级渲染入口 =====
  render() {
    fallbackCtx.clearRect(0, 0, W, H)
    const sx = this.shakeT > 0 ? (Math.random() - 0.5) * this.shakeI * S : 0
    const sy = this.shakeT > 0 ? (Math.random() - 0.5) * this.shakeI * S : 0
    fallbackCtx.save(); fallbackCtx.translate(sx, sy)
    switch (this.scene) {
      case 'loading': screens.rLoading(this); break
      case 'title': screens.rTitle(this); break
      case 'prepare': prepareView.rPrepare(this); break
      case 'event': eventView.rEvent(this); break
      case 'battle': battleView.rBattle(this); break
      case 'reward': screens.rReward(this); break
      case 'shop': screens.rShop(this); break
      case 'rest': screens.rRest(this); break
      case 'adventure': screens.rAdventure(this); break
      case 'gameover': screens.rGameover(this); break
      case 'ranking': screens.rRanking(this); break
      case 'stats': screens.rStats(this); break
      case 'dex': screens.rDex(this); break
    }
    this.dmgFloats.forEach(f => R.drawDmgFloat(f))
    this.skillEffects.forEach(e => R.drawSkillEffect(e))
    if (this.skillCastAnim.active) R.drawSkillCast(this.skillCastAnim)
    if (tutorial.isActive() && this.scene === 'battle') {
      battleView.drawTutorialOverlay(this)
    }
    if (this._petObtainedPopup) {
      eventView.drawPetObtainedPopup(this, this._petObtainedPopup)
    }
    if (this._star3Celebration) {
      dialogs.drawStar3Celebration(this)
    }
    fallbackCtx.restore()
  }

  // ===== 场景渲染委托桩 =====
  _rLoading() { screens.rLoading(this) }
  _rTitle() { screens.rTitle(this) }
  _rPrepare() { prepareView.rPrepare(this) }
  _rEvent() { eventView.rEvent(this) }
  _rBattle() { battleView.rBattle(this) }
  _rReward() { screens.rReward(this) }
  _rShop() { screens.rShop(this) }
  _rRest() { screens.rRest(this) }
  _rAdventure() { screens.rAdventure(this) }
  _rGameover() { screens.rGameover(this) }
  _rRanking() { screens.rRanking(this) }
  _rStats() { screens.rStats(this) }
  _drawPrepareTip() { prepareView.drawPrepareTip(this) }
  _wrapText(text, maxW, fontSize) { return prepareView.wrapText(text, maxW, fontSize) }
  _drawEventPetDetail() { eventView.drawEventPetDetail(this) }
  async _openRanking() {
    const t0 = Date.now()
    console.log('[Ranking] 打开排行榜, cloudReady=', this.storage._cloudReady, 'authorized=', this.storage.userAuthorized)
    this.storage.destroyUserInfoBtn()
    this.rankTab = 'all'
    this.rankScrollY = 0
    this.scene = 'ranking'
    if (this.storage._cloudReady) {
      await this.storage.fetchRanking('all')
    } else {
      this.storage.rankLoadingMsg = '云环境未就绪'
    }
    console.log('[Ranking] 排行榜加载完成, 总耗时', Date.now() - t0, 'ms')
  }

  _updateTitleAuthBtn() {
    if (this.scene !== 'title') {
      this.storage.destroyUserInfoBtn()
      return
    }
    if (this.storage.userAuthorized) {
      this.storage.destroyUserInfoBtn()
      return
    }
    const btnRect = this._rankBtnRect
    if (!btnRect) return
    const cssRect = {
      left: btnRect[0] / dpr,
      top: btnRect[1] / dpr,
      width: btnRect[2] / dpr,
      height: btnRect[3] / dpr,
    }
    if (!this.storage._userInfoBtn) {
      console.log('[AuthBtn] 创建透明授权按钮, cssRect:', JSON.stringify(cssRect), 'canvasRect:', JSON.stringify(btnRect))
      this.storage.showUserInfoBtn(cssRect, (ok, info) => {
        console.log('[AuthBtn] 授权回调, ok:', ok, 'info:', info)
        if (ok) {
          console.log('[Ranking] 授权成功:', info.nickName, info.avatarUrl)
        } else {
          console.warn('[Ranking] 用户拒绝授权，以游客身份进入排行榜')
        }
        this._openRanking()
      })
    }
  }

  _updateFeedbackBtn() {
    if (this.scene !== 'title' || this.showNewRunConfirm) {
      this._destroyFeedbackBtn(); return
    }
    const rect = this._feedbackBtnRect
    if (!rect) { this._destroyFeedbackBtn(); return }
    const cssRect = {
      left: rect[0] / dpr, top: rect[1] / dpr,
      width: rect[2] / dpr, height: rect[3] / dpr,
    }
    if (!this._feedbackBtn) {
      try {
        const btn = wx.createFeedbackButton({
          type: 'text', text: '',
          style: {
            left: cssRect.left, top: cssRect.top,
            width: cssRect.width, height: cssRect.height,
            backgroundColor: 'rgba(0,0,0,0)',
            borderColor: 'rgba(0,0,0,0)', borderWidth: 0, borderRadius: 0,
            color: 'rgba(0,0,0,0)', fontSize: 1, lineHeight: cssRect.height,
          },
        })
        this._feedbackBtn = btn
        btn.show()
      } catch (e) {
        console.warn('[Feedback] createFeedbackButton 失败:', e)
      }
    } else {
      try {
        this._feedbackBtn.style.left = cssRect.left
        this._feedbackBtn.style.top = cssRect.top
        this._feedbackBtn.style.width = cssRect.width
        this._feedbackBtn.style.height = cssRect.height
      } catch (e) { }
    }
  }

  _destroyFeedbackBtn() {
    if (this._feedbackBtn) {
      try { this._feedbackBtn.hide(); this._feedbackBtn.destroy() } catch (e) { }
      this._feedbackBtn = null
    }
  }

  // ===== 视图委托桩 =====
  _drawTeamBar(topY, barH, iconSize) { battleView.drawTeamBar(this, topY, barH, iconSize) }
  _drawBoard() { battleView.drawBoard(this) }
  _drawVictoryOverlay() { battleView.drawVictoryOverlay(this) }
  _drawDefeatOverlay() { battleView.drawDefeatOverlay(this) }
  _drawAdReviveOverlay() { battleView.drawAdReviveOverlay(this) }
  _drawBackBtn() { screens.drawBackBtn(this) }
  _handleBackToTitle() {
    if (this.scene === 'gameover' || this.scene === 'ranking' || this.scene === 'stats') {
      this.scene = 'title'
    } else {
      this._saveAndExit()
    }
  }
  _drawExitDialog() { dialogs.drawExitDialog(this) }
  _drawNewRunConfirm() { screens.drawNewRunConfirm(this) }
  _drawBuffIcons(buffs, x, y) { battleView.drawBuffIcons(buffs, x, y) }
  _drawBuffIconsLabeled(buffs, x, y, label, isEnemy) { battleView.drawBuffIconsLabeled(buffs, x, y, label, isEnemy) }
  _drawRunBuffIcons(topY, bottomY) { battleView.drawRunBuffIcons(this, topY, bottomY) }
  _drawRunBuffDetailDialog() { dialogs.drawRunBuffDetailDialog(this) }
  _drawEnemyDetailDialog() { dialogs.drawEnemyDetailDialog(this) }
  _drawWeaponDetailDialog() { dialogs.drawWeaponDetailDialog(this) }
  _drawBattlePetDetailDialog() { dialogs.drawBattlePetDetailDialog(this) }
  _getBattleLayout() {
    const boardPad = 6 * S, cellSize = (W - boardPad * 2) / COLS, boardH = ROWS * cellSize
    const boardTop = H - 8 * S - boardH
    const sidePad = 8 * S, petGap = 8 * S, wpnGap = 12 * S
    const totalGapW = wpnGap + petGap * 4 + sidePad * 2
    const iconSize = (W - totalGapW) / 6
    const teamBarH = iconSize + 6 * S
    const hpBarH = 18 * S
    const hpBarY = boardTop - hpBarH - 4 * S
    const teamBarY = hpBarY - teamBarH - 2 * S
    const eAreaTop = safeTop + 4 * S
    return { boardPad, cellSize, boardH, boardTop, iconSize, teamBarH, teamBarY, hpBarY, eAreaTop }
  }

  _getEnemyCenterY() {
    const L = this._getBattleLayout()
    const eAreaBottom = L.teamBarY - 4 * S
    const eAreaH = eAreaBottom - L.eAreaTop
    return L.eAreaTop + eAreaH * 0.42
  }

  _playHeroAttack(skillName, attr, type) {
    this.heroAttackAnim = { active: true, progress: 0, duration: 24 }
    this.enemyHurtAnim = { active: true, progress: 0, duration: 18 }
    this._enemyHitFlash = 12
    const color = ATTR_COLOR[attr]?.main || TH.accent
    const eCenterY = this._getEnemyCenterY()
    this.skillCastAnim = { active: true, progress: 0, duration: 30, type: type || 'slash', color, skillName: skillName || '', targetX: W * 0.5, targetY: eCenterY }
  }

  _playEnemyAttack() {
    this.enemyAttackAnim = { active: true, progress: 0, duration: 20 }
    this.heroHurtAnim = { active: true, progress: 0, duration: 18 }
    const L = this._getBattleLayout()
    this.skillCastAnim = { active: true, progress: 0, duration: 30, type: 'enemyAtk', color: TH.danger, skillName: '', targetX: W * 0.5, targetY: L.hpBarY }
  }

  _playHealEffect() {
    const L = this._getBattleLayout()
    this.skillCastAnim = { active: true, progress: 0, duration: 25, type: 'heal', color: '#4dcc4d', skillName: '', targetX: W * 0.5, targetY: L.hpBarY }
    MusicMgr.playHeal()
  }

  // ===== 触摸入口 =====
  onTouch(type, e) {
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0])
    if (!t) return
    const x = t.clientX * dpr, y = t.clientY * dpr
    switch (this.scene) {
      case 'title': touchH.tTitle(this, type, x, y); break
      case 'prepare': touchH.tPrepare(this, type, x, y); break
      case 'event': touchH.tEvent(this, type, x, y); break
      case 'battle': touchH.tBattle(this, type, x, y); break
      case 'reward': touchH.tReward(this, type, x, y); break
      case 'shop': touchH.tShop(this, type, x, y); break
      case 'rest': touchH.tRest(this, type, x, y); break
      case 'adventure': touchH.tAdventure(this, type, x, y); break
      case 'gameover': touchH.tGameover(this, type, x, y); break
      case 'ranking': touchH.tRanking(this, type, x, y); break
      case 'stats': touchH.tStats(this, type, x, y); break
      case 'dex': touchH.tDex(this, type, x, y); break
    }
  }

  // ===== 触摸委托桩 =====
  _tTitle(type, x, y) { touchH.tTitle(this, type, x, y) }
  _tPrepare(type, x, y) { touchH.tPrepare(this, type, x, y) }
  _tEvent(type, x, y) { touchH.tEvent(this, type, x, y) }
  _tBattle(type, x, y) { touchH.tBattle(this, type, x, y) }
  _tReward(type, x, y) { touchH.tReward(this, type, x, y) }
  _tShop(type, x, y) { touchH.tShop(this, type, x, y) }
  _tRest(type, x, y) { touchH.tRest(this, type, x, y) }
  _tAdventure(type, x, y) { touchH.tAdventure(this, type, x, y) }
  _tGameover(type, x, y) { touchH.tGameover(this, type, x, y) }
  _tRanking(type, x, y) { touchH.tRanking(this, type, x, y) }
  _tStats(type, x, y) { touchH.tStats(this, type, x, y) }
  _enterEvent() { this._eventPetDetail = null; this._eventPetDetailData = null; this._eventWpnDetail = null; this._eventWpnDetailData = null; this._eventDragPet = null; this._eventShopUsedCount = 0; this._eventShopUsedItems = null; this._shopSelectAttr = false; this._shopSelectPet = null; this.scene = 'event' }
  _showSkillPreview(pet, index) { skillEngine.showSkillPreview(this, pet, index) }
  _enterBattle(enemyData) { battleEngine.enterBattle(this, enemyData) }
  _initBoard() { battleEngine.initBoard(this) }
  _cellAttr(r, c) { return battleEngine.cellAttr(this, r, c) }
  _checkAndElim() {
    if (this._pendingEnemyAtk) {
      this._pendingEnemyAtk = null
      this._enemyTurn()
      if (this.bState !== 'playerTurn' && this.bState !== 'enemyTurn') return
      if (this.bState === 'enemyTurn') {
        const stunIdx = this.heroBuffs.findIndex(b => b.type === 'heroStun')
        if (stunIdx >= 0) {
          this.heroBuffs.splice(stunIdx, 1)
          this.skillEffects.push({ x: ViewEnv.W * 0.5, y: ViewEnv.H * 0.5, text: '被眩晕！跳过操作', color: '#ff4444', t: 0, alpha: 1 })
          this._pendingEnemyAtk = { timer: 0, delay: 24 }
        }
        this.bState = 'playerTurn'
        if (tutorial.isActive()) tutorial.onEnemyTurnEnd(this)
      }
    }
    battleEngine.checkAndElim(this)
  }
  _startNextElimAnim() { battleEngine.startNextElimAnim(this) }
  _processElim() { battleEngine.processElim(this) }
  _processDropAnim() { battleEngine.processDropAnim(this) }
  _findMatchesSeparate() { return battleEngine.findMatchesSeparate(this) }
  _fillBoard() { battleEngine.fillBoard(this) }
  _enterPetAtkShow() { battleEngine.enterPetAtkShow(this) }
  _executeAttack() { battleEngine.executeAttack(this) }
  _calcCrit() { return battleEngine.calcCrit(this) }
  _applyFinalDamage(dmgMap, heal) { battleEngine.applyFinalDamage(this, dmgMap, heal) }
  _settle() { battleEngine.settle(this) }
  _enemyTurn() { battleEngine.enemyTurn(this) }
  _applyEnemySkill(sk) { battleEngine.applyEnemySkill(this, sk) }
  _triggerPetSkill(pet, idx) { skillEngine.triggerPetSkill(this, pet, idx) }
  _applyReward(rw) { skillEngine.applyReward(this, rw) }
  _applyBuffReward(b) { skillEngine.applyBuffReward(this, b) }
  _applyShopItem(item) { skillEngine.applyShopItem(this, item) }
  _applyShopPetByAttr(attr) { skillEngine.applyShopPetByAttr(this, attr) }
  _applyShopStarUp(petIdx) { return skillEngine.applyShopStarUp(this, petIdx) }
  _applyShopUpgradePet(petIdx, pct) { return skillEngine.applyShopUpgradePet(this, petIdx, pct) }
  _applyShopCdReduce(petIdx) { return skillEngine.applyShopCdReduce(this, petIdx) }
  _applyRestOption(opt) { skillEngine.applyRestOption(this, opt) }
  _applyAdventure(adv) { skillEngine.applyAdventure(this, adv) }
  _addShield(val) {
    if (this.weapon && this.weapon.type === 'shieldBoost') {
      val = Math.round(val * (1 + (this.weapon.pct || 50) / 100))
    }
    this.heroShield += val
    MusicMgr.playShieldGain()
    this.dmgFloats.push({ x: W * 0.5, y: H * 0.65, text: `+${val}盾`, color: '#7ddfff', t: 0, alpha: 1 })
  }

  _dealDmgToHero(dmg) {
    const immune = this.heroBuffs && this.heroBuffs.find(b => b.type === 'dmgImmune')
    if (immune && dmg > 1) dmg = 1
    if (this.heroShield > 0) {
      if (dmg <= this.heroShield) {
        this.heroShield -= dmg
        this.skillEffects.push({ x: W * 0.5, y: H * 0.52, text: '完美抵挡！', color: '#40e8ff', t: 0, alpha: 1, scale: 2.5, _initScale: 2.5, big: true })
        this.dmgFloats.push({ x: W * 0.5, y: H * 0.6, text: `护盾吸收 ${dmg}`, color: '#7ddfff', t: 0, alpha: 1, scale: 1.6 })
        this.shakeT = 4; this.shakeI = 2
        this._blockFlash = 8
        MusicMgr.playBlock()
        return
      }
      const shieldAbs = this.heroShield
      dmg -= this.heroShield; this.heroShield = 0
      this.skillEffects.push({ x: W * 0.5, y: H * 0.52, text: '护盾击碎！', color: '#ff9040', t: 0, alpha: 1, scale: 2.0, _initScale: 2.0 })
      this.dmgFloats.push({ x: W * 0.45, y: H * 0.6, text: `盾挡 ${shieldAbs}`, color: '#40b8e0', t: 0, alpha: 1, scale: 1.4 })
    }
    const oldPct = this.heroHp / this.heroMaxHp
    this.heroHp = Math.max(0, this.heroHp - dmg)
    this._heroHpLoss = { fromPct: oldPct, timer: 0 }
    this.dmgFloats.push({ x: W * 0.5, y: H * 0.7, text: `-${dmg}`, color: TH.danger, t: 0, alpha: 1 })
  }

  _onDefeat() { runMgr.onDefeat(this, W, H) }
  _doAdRevive() { runMgr.doAdRevive(this, W, H) }
  _adReviveCallback() { runMgr.adReviveCallback(this, W, H) }

  _getShareData() {
    const st = this.storage.stats
    const floor = this.storage.bestFloor
    const isCleared = floor >= 30
    const dexCount = (this.storage.petDex || []).length
    const title = isCleared
      ? `${st.bestTotalTurns ? st.bestTotalTurns + '回合' : ''}通关五行通天塔！收集${dexCount}只灵兽，你敢来挑战吗？`
      : `我已攻到消消塔第${floor}层，收集了${dexCount}只灵兽，你能比我更强吗？`
    return { title, imageUrl: isCleared ? 'assets/share/share_cover.jpg' : 'assets/share/share_default.jpg' }
  }

  _shareStats() {
    const st = this.storage.stats
    const floor = this.storage.bestFloor
    const isCleared = floor >= 30
    const dexCount = (this.storage.petDex || []).length
    const bestTurns = st.bestTotalTurns || 0
    const titles = isCleared
      ? [
        `五行通天塔已通关！${bestTurns ? bestTurns + '回合极速登顶，' : ''}收集${dexCount}只灵兽，你敢来挑战吗？`,
        `${bestTurns ? '仅用' + bestTurns + '回合' : '已'}通关消消塔！${dexCount}只灵兽助我登顶，不服来战！`,
        `通天塔30层全通关！最高${st.maxCombo}连击，${dexCount}只灵兽收入囊中，等你来超越！`,
      ]
      : [
        `我已攻到消消塔第${floor}层，收集了${dexCount}只灵兽，最高${st.maxCombo}连击！你能超越吗？`,
        `消消塔第${floor}层！${dexCount}只灵兽助阵，${bestTurns ? bestTurns + '回合最速记录，' : ''}来挑战我吧！`,
        `五行通天塔第${floor}层，最高${st.maxCombo}连击！收集${dexCount}只灵兽，你敢来比吗？`,
      ]
    wx.shareAppMessage({
      title: titles[Math.floor(Math.random() * titles.length)],
      imageUrl: 'assets/share/share_cover.jpg',
    })
  }

  _hitRect(x, y, rx, ry, rw, rh) { return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh }

  // ===== scene属性代理 =====
  get scene() { return this._scene }
  set scene(v) {
    if (this._scene !== v) {
      console.log(`[Main] scene: ${this._scene} → ${v}`)
      this._scene = v
      if (pixiReady) {
        SceneManager.switchTo(v)
        // 重置目标场景的脏标记，确保进入时重建
        const builder = sceneBuilders[v]
        if (builder) {
          if (builder._lastKey !== undefined) builder._lastKey = ''
          if (!builder._built) {
            try {
              builder.build(this)
            } catch(e) {
              console.error(`[Main] ${v} build失败:`, e.message, e.stack)
            }
          }
        }
      }
    }
  }
}

new Main()
