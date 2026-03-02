/**
 * 通用 PixiJS 对象池
 * 所有场景共享的 Graphics / Text / Sprite 池化复用方案
 * 避免每帧 new 对象 + GC 的巨大开销
 *
 * 使用方式：
 *   const pool = new FramePool(parentContainer)
 *   // 每帧开始
 *   pool.reset()
 *   // 获取对象
 *   const g = pool.gfx()
 *   const t = pool.txt('hello', { fontSize:14, fill:'#fff', anchor:0.5 })
 *   const s = pool.spr('assets/xxx.png')
 *   // 每帧结束
 *   pool.hideUnused()
 */
const PIXI = require('../libs/pixi-wrapper')

class FramePool {
  constructor(parent, deps) {
    this._parent = parent
    this._deps = deps || {}  // { PR, AssetManager }
    // Graphics
    this._gfx = []; this._gi = 0
    // Text
    this._txt = []; this._ti = 0
    // Sprite
    this._spr = []; this._si = 0
  }

  /** 每帧开始时调用，重置索引 */
  reset() {
    this._gi = 0; this._ti = 0; this._si = 0
  }

  /** 每帧结束时调用，隐藏未使用的对象 */
  hideUnused() {
    for (let i = this._gi; i < this._gfx.length; i++) {
      this._gfx[i].visible = false; this._gfx[i].clear()
    }
    for (let i = this._ti; i < this._txt.length; i++) {
      this._txt[i].visible = false
    }
    for (let i = this._si; i < this._spr.length; i++) {
      this._spr[i].visible = false
    }
  }

  /** 获取一个 Graphics 对象 */
  gfx(target) {
    const p = target || this._parent
    let g
    if (this._gi < this._gfx.length) {
      g = this._gfx[this._gi]
      g.clear(); g.visible = true; g.alpha = 1
      g.blendMode = PIXI.BLEND_MODES.NORMAL
      g.position.set(0, 0); g.scale.set(1); g.rotation = 0
      if (g.parent !== p) p.addChild(g)
    } else {
      g = new PIXI.Graphics()
      this._gfx.push(g)
      p.addChild(g)
    }
    this._gi++
    return g
  }

  /** 获取一个 Text 对象 */
  txt(str, opts, target) {
    const p = target || this._parent
    const PR = this._deps.PR
    let t
    if (this._ti < this._txt.length) {
      t = this._txt[this._ti]
      t.visible = true; t.alpha = 1; t.scale.set(1)
      t.rotation = 0; t.position.set(0, 0)
      t.text = str
      const s = t.style
      s.fontSize = opts.fontSize || 14
      s.fill = opts.fill || '#eeeeee'
      s.fontWeight = opts.fontWeight || 'bold'
      s.stroke = opts.stroke || 'transparent'
      s.strokeThickness = opts.strokeThickness || 0
      s.dropShadow = !!opts.dropShadow
      s.dropShadowColor = opts.dropShadowColor || '#000000'
      s.dropShadowBlur = opts.dropShadowBlur || 0
      s.dropShadowDistance = opts.dropShadowDistance || 0
      s.wordWrap = opts.wordWrap || false
      s.wordWrapWidth = opts.wordWrapWidth || 300
      if (t.parent !== p) p.addChild(t)
    } else {
      t = PR ? PR.createText(str, opts) : new PIXI.Text(str, opts)
      this._txt.push(t)
      p.addChild(t)
    }
    if (opts.anchor !== undefined) {
      if (typeof opts.anchor === 'number') t.anchor.set(opts.anchor)
      else if (opts.anchor) t.anchor.set(opts.anchor.x || 0, opts.anchor.y || 0)
    }
    this._ti++
    return t
  }

  /** 获取一个 Sprite 对象 */
  spr(path, target) {
    const p = target || this._parent
    const AM = this._deps.AssetManager || require('./AssetManager')
    const tex = AM.getTexture(path)
    let sp
    if (this._si < this._spr.length) {
      sp = this._spr[this._si]
      sp.visible = true; sp.alpha = 1; sp.tint = 0xffffff
      sp.anchor.set(0, 0); sp.scale.set(1); sp.rotation = 0
      sp.position.set(0, 0)
      if (tex) { sp.texture = tex }
      else { sp.texture = PIXI.Texture.WHITE; sp.alpha = 0 }
      if (sp.parent !== p) p.addChild(sp)
    } else {
      if (tex) { sp = new PIXI.Sprite(tex) }
      else { sp = new PIXI.Sprite(PIXI.Texture.WHITE); sp.alpha = 0 }
      this._spr.push(sp)
      p.addChild(sp)
      if (!tex) {
        AM._loadTexture(path).then(lt => {
          if (lt && !sp.destroyed) { sp.texture = lt; sp.alpha = 1 }
        })
      }
    }
    this._si++
    return sp
  }

  /** 获取一个灵珠 Sprite（anchor 0.5） */
  bead(attr, size, target) {
    const p = target || this._parent
    const AM = this._deps.AssetManager || require('./AssetManager')
    const path = `assets/orbs/orb_${attr}.png`
    const tex = AM.getTexture(path)
    let sp
    if (this._si < this._spr.length) {
      sp = this._spr[this._si]
      sp.visible = true; sp.alpha = 1; sp.tint = 0xffffff
      sp.anchor.set(0.5); sp.scale.set(1); sp.rotation = 0
      sp.position.set(0, 0)
      if (tex) sp.texture = tex
      if (sp.parent !== p) p.addChild(sp)
    } else {
      sp = tex ? new PIXI.Sprite(tex) : new PIXI.Sprite(PIXI.Texture.WHITE)
      sp.anchor.set(0.5)
      this._spr.push(sp)
      p.addChild(sp)
      if (!tex) {
        AM._loadTexture(path).then(lt => { if (lt && !sp.destroyed) sp.texture = lt })
      }
    }
    sp.width = size; sp.height = size
    this._si++
    return sp
  }

  /** 清空所有池（场景切换时） */
  clear() {
    this._gfx.length = 0; this._txt.length = 0; this._spr.length = 0
    this.reset()
  }

  /** 池化 HP 条绘制 */
  hpBar(x, y, w, h, hp, maxHp, color, showNum, target) {
    const PR = this._deps.PR
    const S = this._deps.S || 1
    const pct = Math.max(0, Math.min(1, hp / maxHp))
    const cI = PR.colorToInt(color || (pct > 0.5 ? '#4dcc4d' : pct > 0.2 ? '#ff8c00' : '#ff4d6a'))
    const bg = this.gfx(target); bg.beginFill(0x000000, 0.5); bg.drawRoundedRect(x, y, w, h, h / 2); bg.endFill()
    if (pct > 0) {
      const fill = this.gfx(target); fill.beginFill(cI); fill.drawRoundedRect(x, y, w * pct, h, h / 2); fill.endFill()
      const hl = this.gfx(target); hl.beginFill(0xffffff, 0.3); hl.drawRoundedRect(x + 2 * S, y + 1, w * pct - 4 * S, h * 0.35, h / 4); hl.endFill()
    }
    const bd = this.gfx(target); bd.lineStyle(1, 0x000000, 0.3); bd.drawRoundedRect(x, y, w, h, h / 2)
    if (showNum) {
      const t = this.txt(`${Math.round(hp)}/${Math.round(maxHp)}`, {
        fontSize: Math.max(8 * S, h * 0.7), fill: '#ffffff', fontWeight: 'bold',
        anchor: 0.5, stroke: '#000000', strokeThickness: 2 * S
      }, target)
      t.position.set(x + w / 2, y + h / 2)
    }
  }
}

module.exports = { FramePool }
