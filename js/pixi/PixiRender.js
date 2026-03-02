/**
 * PixiJS 版渲染工具
 * 提供 Graphics / Sprite / Text 的工厂方法
 * 替代原 render.js 中的 Canvas 2D 绘制逻辑
 */
const PIXI = require('../libs/pixi-wrapper')
const V = require('./ViewEnv')
const assets = require('./AssetManager')

// 工具：CSS颜色字符串 → 0xRRGGBB 整数
function colorToInt(c) {
  if (typeof c === 'number') return c
  if (!c || typeof c !== 'string') return 0xffffff
  c = c.trim()
  if (c.startsWith('#')) {
    const hex = c.slice(1)
    if (hex.length === 3) {
      return parseInt(hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2], 16)
    }
    return parseInt(hex.substring(0, 6), 16)
  }
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (m) return (+m[1] << 16) | (+m[2] << 8) | +m[3]
  return 0xffffff
}

// 工具：提亮颜色
function lighten(colorInt, amount) {
  const r = Math.min(255, ((colorInt >> 16) & 0xff) + Math.round(255 * (amount || 0.3)))
  const g = Math.min(255, ((colorInt >> 8) & 0xff) + Math.round(255 * (amount || 0.3)))
  const b = Math.min(255, (colorInt & 0xff) + Math.round(255 * (amount || 0.3)))
  return (r << 16) | (g << 8) | b
}

// 工具：加深颜色
function darken(colorInt) {
  const r = Math.round(((colorInt >> 16) & 0xff) * 0.7)
  const g = Math.round(((colorInt >> 8) & 0xff) * 0.7)
  const b = Math.round((colorInt & 0xff) * 0.7)
  return (r << 16) | (g << 8) | b
}

/**
 * 绘制圆角矩形到 Graphics
 */
function drawRoundedRect(g, x, y, w, h, r) {
  g.drawRoundedRect(x, y, w, h, r || 0)
  return g
}

/**
 * 创建文字对象
 * @param {string} text
 * @param {object} opts - { fontSize, fill, fontWeight, align, anchor, stroke, strokeThickness }
 * @returns {PIXI.Text}
 */
function createText(text, opts = {}) {
  const S = V.S
  const styleDef = {
    fontFamily: '"PingFang SC", sans-serif',
    fontSize: opts.fontSize || 14 * S,
    fontWeight: opts.fontWeight || 'bold',
    fill: opts.fill || '#eeeeee',
    align: opts.align || 'center',
    strokeThickness: opts.strokeThickness || 0,
    dropShadow: !!opts.dropShadow,
    dropShadowColor: opts.dropShadowColor || '#000000',
    dropShadowBlur: opts.dropShadowBlur || 0,
    dropShadowDistance: opts.dropShadowDistance || 0,
    wordWrap: opts.wordWrap || false,
    wordWrapWidth: opts.wordWrapWidth || 300,
  }
  // PixiJS v7 的 stroke 不接受 null，只在有值时设置
  if (opts.stroke) styleDef.stroke = opts.stroke
  if (opts.lineHeight) styleDef.lineHeight = opts.lineHeight
  const style = new PIXI.TextStyle(styleDef)
  const t = new PIXI.Text(text, style)
  if (opts.anchor !== undefined) {
    if (typeof opts.anchor === 'number') {
      t.anchor.set(opts.anchor)
    } else if (opts.anchor) {
      t.anchor.set(opts.anchor.x || 0, opts.anchor.y || 0)
    }
  }
  return t
}

/**
 * 创建精灵（从路径）
 * @param {string} path - 图片路径
 * @returns {PIXI.Sprite}
 */
function createSprite(path) {
  const tex = assets.getTexture(path)
  if (tex) {
    return new PIXI.Sprite(tex)
  }
  // 纹理未加载，创建空精灵，异步更新
  const sprite = new PIXI.Sprite(PIXI.Texture.WHITE)
  sprite.alpha = 0
  assets._loadTexture(path).then((loadedTex) => {
    if (loadedTex && !sprite.destroyed) {
      sprite.texture = loadedTex
      sprite.alpha = 1
    }
  })
  return sprite
}

/**
 * 创建HP条容器
 * @param {object} opts - { x, y, w, h, hp, maxHp, color, showNum }
 * @returns {PIXI.Container}
 */
function createHpBar(opts) {
  const S = V.S
  const { x, y, w, h, hp, maxHp, color, showNum } = opts
  const container = new PIXI.Container()
  container.position.set(x, y)

  const pct = Math.max(0, Math.min(1, hp / maxHp))
  const colorInt = colorToInt(color || (pct > 0.5 ? '#4dcc4d' : pct > 0.2 ? '#ff8c00' : '#ff4d6a'))

  // 槽背景
  const bg = new PIXI.Graphics()
  bg.beginFill(0x000000, 0.5)
  bg.drawRoundedRect(0, 0, w, h, h / 2)
  bg.endFill()
  container.addChild(bg)

  // 填充
  if (pct > 0) {
    const fill = new PIXI.Graphics()
    fill.beginFill(colorInt)
    fill.drawRoundedRect(0, 0, w * pct, h, h / 2)
    fill.endFill()
    container.addChild(fill)

    // 高光
    const highlight = new PIXI.Graphics()
    highlight.beginFill(0xffffff, 0.3)
    highlight.drawRoundedRect(2 * S, 1, w * pct - 4 * S, h * 0.35, h / 4)
    highlight.endFill()
    container.addChild(highlight)
  }

  // 边框
  const border = new PIXI.Graphics()
  border.lineStyle(1, 0x000000, 0.3)
  border.drawRoundedRect(0, 0, w, h, h / 2)
  container.addChild(border)

  // HP数值
  if (showNum) {
    const hpText = createText(`${Math.round(hp)}/${Math.round(maxHp)}`, {
      fontSize: Math.max(8 * S, h * 0.7),
      fill: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2 * S,
      anchor: 0.5,
    })
    hpText.position.set(w / 2, h / 2)
    container.addChild(hpText)
  }

  // 附加更新方法
  container._updateHp = (newHp, newMax) => {
    // 后续可以在这里实现HP条动画更新
  }

  return container
}

/**
 * 创建按钮
 * @param {object} opts - { x, y, w, h, text, color, pressed }
 * @returns {PIXI.Container}
 */
function createButton(opts) {
  const S = V.S
  const { x, y, w, h, text, color, pressed } = opts
  const container = new PIXI.Container()
  container.position.set(x, y)

  const colorInt = colorToInt(color || '#ffd700')
  const rad = Math.min(10 * S, h / 2)

  // 阴影
  if (!pressed) {
    const shadow = new PIXI.Graphics()
    shadow.beginFill(0x000000, 0.25)
    shadow.drawRoundedRect(0, 4 * S, w, h, rad)
    shadow.endFill()
    container.addChild(shadow)
  }

  // 底层深色
  const base = new PIXI.Graphics()
  base.beginFill(darken(colorInt))
  base.drawRoundedRect(0, 2 * S, w, h, rad)
  base.endFill()
  container.addChild(base)

  // 主体
  const body = new PIXI.Graphics()
  body.beginFill(colorInt)
  body.drawRoundedRect(0, 0, w, h, rad)
  body.endFill()
  container.addChild(body)

  // 高光
  const glow = new PIXI.Graphics()
  glow.beginFill(0xffffff, 0.2)
  glow.drawRoundedRect(1 * S, 1 * S, w - 2 * S, h * 0.5, rad)
  glow.endFill()
  container.addChild(glow)

  // 文字
  const label = createText(text || '', {
    fontSize: Math.min(14 * S, h * 0.45),
    fill: '#ffffff',
    stroke: '#000000',
    strokeThickness: 2 * S,
    anchor: 0.5,
  })
  label.position.set(w / 2, h / 2)
  container.addChild(label)

  // 点击区域
  container.hitArea = new PIXI.Rectangle(0, 0, w, h)

  return container
}

/**
 * 创建深色面板
 */
function createDarkPanel(x, y, w, h, r) {
  const S = V.S
  const rad = r || 10 * S
  const g = new PIXI.Graphics()
  
  // 内凹背景
  g.beginFill(0x000000, 0.15)
  g.drawRoundedRect(x, y - 1 * S, w, h + 1 * S, rad)
  g.endFill()
  
  // 主体
  g.beginFill(0x161623, 0.94)
  g.drawRoundedRect(x, y, w, h, rad)
  g.endFill()
  
  // 边框
  g.lineStyle(1, 0x3c3c50, 0.4)
  g.drawRoundedRect(x, y, w, h, rad)
  
  return g
}

/**
 * 创建毛玻璃卡片
 */
function createGlassCard(x, y, w, h, r) {
  const S = V.S
  const rad = r || 12 * S
  const g = new PIXI.Graphics()
  
  // 阴影
  g.beginFill(0x000000, 0.15)
  g.drawRoundedRect(x + 1 * S, y + 3 * S, w, h, rad)
  g.endFill()
  
  // 主体
  g.beginFill(0xf0f0f5, 0.9)
  g.drawRoundedRect(x, y, w, h, rad)
  g.endFill()
  
  // 边框
  g.lineStyle(1.5, 0xffffff, 0.7)
  g.drawRoundedRect(x, y, w, h, rad)
  
  return g
}

/**
 * 创建背景精灵（cover模式铺满）
 */
function createCoverSprite(path, w, h) {
  const sprite = createSprite(path)
  // 等纹理加载完成后调整尺寸
  const adjustSize = () => {
    if (!sprite.texture || sprite.texture === PIXI.Texture.WHITE) return
    const iw = sprite.texture.width, ih = sprite.texture.height
    const scale = Math.max(w / iw, h / ih)
    sprite.width = iw * scale
    sprite.height = ih * scale
    sprite.x = (w - sprite.width) / 2
    sprite.y = (h - sprite.height) / 2
    sprite.alpha = 1
  }
  // 如果纹理已加载
  if (sprite.texture && sprite.texture !== PIXI.Texture.WHITE) {
    adjustSize()
  } else {
    // 等纹理加载后调整
    const checkInterval = setInterval(() => {
      if (sprite.destroyed) { clearInterval(checkInterval); return }
      if (sprite.texture && sprite.texture !== PIXI.Texture.WHITE) {
        adjustSize()
        clearInterval(checkInterval)
      }
    }, 100)
    // 最多等5秒
    setTimeout(() => clearInterval(checkInterval), 5000)
  }
  return sprite
}

/**
 * 创建灵珠精灵
 */
function createBeadSprite(attr, size) {
  const path = `assets/orbs/orb_${attr}.png`
  const tex = assets.getTexture(path)
  
  if (tex) {
    // 纹理已加载：直接返回 Sprite（避免 Container 包装开销）
    const sprite = new PIXI.Sprite(tex)
    sprite.width = size
    sprite.height = size
    sprite.anchor.set(0.5)
    return sprite
  }
  
  // 降级：纯色圆 + 异步加载
  const container = new PIXI.Container()
  const { BEAD_ATTR_COLOR } = require('../data/tower')
  const colors = BEAD_ATTR_COLOR[attr] || { main: '#888888' }
  const g = new PIXI.Graphics()
  g.beginFill(colorToInt(colors.main))
  g.drawCircle(0, 0, size / 2)
  g.endFill()
  container.addChild(g)
  
  assets._loadTexture(path).then((loadedTex) => {
    if (loadedTex && !container.destroyed) {
      const sprite = new PIXI.Sprite(loadedTex)
      sprite.width = size
      sprite.height = size
      sprite.anchor.set(0.5)
      container.removeChildren()
      container.addChild(sprite)
    }
  })
  
  return container
}

/**
 * 创建遮罩（半透明黑色覆盖）
 */
function createOverlay(alpha) {
  const g = new PIXI.Graphics()
  g.beginFill(0x000000, alpha || 0.5)
  g.drawRect(0, 0, V.W, V.H)
  g.endFill()
  return g
}

/**
 * 创建弹窗面板
 */
function createDialogPanel(x, y, w, h) {
  const S = V.S
  const container = new PIXI.Container()
  
  // 尝试使用图片资源
  const tex = assets.getTexture('assets/ui/dialog_bg.png')
  if (tex) {
    const sprite = new PIXI.Sprite(tex)
    sprite.position.set(x, y)
    sprite.width = w
    sprite.height = h
    container.addChild(sprite)
  } else {
    // Fallback: 深色面板
    const rad = 14 * S
    const g = new PIXI.Graphics()
    g.beginFill(0x141428, 0.95)
    g.drawRoundedRect(x, y, w, h, rad)
    g.endFill()
    g.lineStyle(2 * S, 0xc9a84c, 0.4)
    g.drawRoundedRect(x, y, w, h, rad)
    container.addChild(g)
  }
  
  return container
}

/**
 * 创建场景背景（纯色 + 可选背景图 + 可选暗色遮罩）
 * @param {object} opts - { bgColor, bgImage, overlay, overlayAlpha }
 * @returns {PIXI.Container}
 */
function createSceneBg(opts = {}) {
  const container = new PIXI.Container()
  // 纯色底
  const bg = new PIXI.Graphics()
  bg.beginFill(colorToInt(opts.bgColor || '#050510'))
  bg.drawRect(0, 0, V.W, V.H)
  bg.endFill()
  container.addChild(bg)
  // 背景图
  if (opts.bgImage) {
    const sprite = createCoverSprite(opts.bgImage, V.W, V.H)
    container.addChild(sprite)
  }
  // 暗色遮罩
  if (opts.overlay) {
    const ov = new PIXI.Graphics()
    ov.beginFill(colorToInt(opts.overlay), opts.overlayAlpha || 0.4)
    ov.drawRect(0, 0, V.W, V.H)
    ov.endFill()
    container.addChild(ov)
  }
  return container
}

/**
 * 创建返回首页按钮（左上角暗金风格）
 * @param {object} g - 游戏对象，用于设置 _backBtnRect
 * @returns {PIXI.Container}
 */
function createBackBtn(g) {
  const S = V.S
  const btnW = 64*S, btnH = 30*S
  const bx = 8*S, by = V.safeTop + 6*S
  const container = new PIXI.Container()
  container.position.set(bx, by)
  // 暗金底板
  const bg = new PIXI.Graphics()
  bg.beginFill(0x281e0f, 0.82)
  bg.drawRoundedRect(0, 0, btnW, btnH, btnH*0.5)
  bg.endFill()
  // 金色描边
  bg.lineStyle(1*S, 0xd4af37, 0.5)
  bg.drawRoundedRect(0, 0, btnW, btnH, btnH*0.5)
  container.addChild(bg)
  // 文字
  const label = createText('◁ 首页', {
    fontSize: 12*S,
    fill: '#f0dca0',
    fontWeight: 'bold',
    anchor: 0.5,
    stroke: '#000000',
    strokeThickness: 2*S,
  })
  label.position.set(btnW*0.5, btnH*0.5)
  container.addChild(label)
  // 注册触摸区域
  if (g) g._backBtnRect = [bx, by, btnW, btnH]
  return container
}

/**
 * 创建标题区（大标题文字 + 装饰分割线）
 * @param {string} title - 标题文字
 * @param {object} opts - { y, color, dividerWidth }
 * @returns {PIXI.Container}
 */
function createTitleHeader(title, opts = {}) {
  const S = V.S
  const container = new PIXI.Container()
  const baseY = opts.y || (V.safeTop + 40*S)
  // 标题
  const text = createText(title, {
    fontSize: 22*S,
    fill: opts.color || '#f5e6c8',
    fontWeight: 'bold',
    anchor: { x: 0.5, y: 0 },
    stroke: '#000000',
    strokeThickness: 4*S,
    dropShadow: true,
    dropShadowColor: '#000000',
    dropShadowBlur: 4*S,
    dropShadowDistance: 0,
  })
  text.position.set(V.W*0.5, baseY)
  container.addChild(text)
  // 分割线
  const divW = opts.dividerWidth || V.W*0.22
  const divY = baseY + 28*S
  const line = new PIXI.Graphics()
  line.lineStyle(1*S, 0xd4af37, 0.35)
  line.moveTo(V.W*0.5 - divW, divY)
  line.lineTo(V.W*0.5 + divW, divY)
  container.addChild(line)
  return container
}

/**
 * 创建暗色卡片（商店/休息用暗色渐变卡片 + 金色边框）
 */
function createDarkCard(x, y, w, h, r) {
  const S = V.S
  const rad = r || 10*S
  const g = new PIXI.Graphics()
  // 主体暗色
  g.beginFill(0x1e1912, 0.9)
  g.drawRoundedRect(x, y, w, h, rad)
  g.endFill()
  // 金色边框
  g.lineStyle(1*S, 0xd4af37, 0.3)
  g.drawRoundedRect(x, y, w, h, rad)
  return g
}

/**
 * 创建暖白信息面板
 */
function createInfoPanel(x, y, w, h, r) {
  const S = V.S
  const rad = r || 14*S
  const g = new PIXI.Graphics()
  g.beginFill(0xf8f2e6, 0.95)
  g.drawRoundedRect(x, y, w, h, rad)
  g.endFill()
  g.lineStyle(1.5*S, 0xc9a84c, 0.4)
  g.drawRoundedRect(x, y, w, h, rad)
  return g
}

/**
 * 创建图片按钮（图片+叠加文字）
 */
function createImgBtn(imgPath, x, y, w, h, text, fontSize) {
  const S = V.S
  const container = new PIXI.Container()
  container.position.set(x, y)
  const sprite = createSprite(imgPath)
  sprite.width = w
  sprite.height = h
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
  container.addChild(sprite)
  if (text) {
    const label = createText(text, {
      fontSize: (fontSize || 14)*S,
      fill: '#5a2d0c',
      fontWeight: 'bold',
      anchor: 0.5,
    })
    label.position.set(w/2, h/2)
    container.addChild(label)
  }
  return container
}

module.exports = {
  colorToInt,
  lighten,
  darken,
  drawRoundedRect,
  createText,
  createSprite,
  createHpBar,
  createButton,
  createDarkPanel,
  createGlassCard,
  createCoverSprite,
  createBeadSprite,
  createOverlay,
  createDialogPanel,
  createSceneBg,
  createBackBtn,
  createTitleHeader,
  createDarkCard,
  createInfoPanel,
  createImgBtn,
}
