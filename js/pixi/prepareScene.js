/**
 * Prepare 场景原生 PixiJS 构建器
 * 【性能优化版】对象池复用，避免每帧创建/销毁对象
 * 阵容编辑（宠物/法宝切换）+ 详情Tips浮层
 */
const PIXI = require('../libs/pixi-wrapper')
const { FramePool } = require('./ObjectPool')

function createPrepareBuilder(deps) {
  const { SceneManager, PR, W, H, S, safeTop, AssetManager } = deps

  let _pool = null
  let _layer = null
  // 静态背景层（不需要每帧重建）
  let _bgLayer = null
  let _bgBuilt = false

  function _ensureLayers(scene) {
    if (!_bgLayer) {
      _bgLayer = new PIXI.Container(); _bgLayer.name = 'bg'
      scene.addChild(_bgLayer)
    }
    if (!_layer) {
      _layer = new PIXI.Container(); _layer.name = 'dynamic'
      scene.addChild(_layer)
      _pool = new FramePool(_layer, { PR, AssetManager, S })
    }
  }

  return {
    _built: false,
    _petBagScrollY: 0,
    _wpnBagScrollY: 0,
    build(g) {
      this._built = true
      _bgBuilt = false; _bgLayer = null; _layer = null; _pool = null
    },
    update(g) {
      const scene = SceneManager.getScene('prepare')
      if (!scene) return
      _ensureLayers(scene)

      const { ATTR_COLOR, ATTR_NAME } = require('../data/tower')
      const { getPetStarAtk, getPetAvatarPath, petHasSkill, getPetSkillDesc } = require('../data/pets')

      // 静态背景只建一次
      if (!_bgBuilt) {
        _bgLayer.removeChildren()
        _bgLayer.addChild(PR.createSceneBg({ bgColor: '#0c0818', bgImage: 'assets/backgrounds/bg_default.jpg', overlay: '#050510', overlayAlpha: 0.55 }))
        _bgBuilt = true
      }

      // 动态层每帧池化复用
      _pool.reset()

      // 标题
      const title = _pool.txt('── 阵容编辑 ──', { fontSize: 18 * S, fill: '#f5e6c8', fontWeight: 'bold', anchor: 0.5, stroke: '#000', strokeThickness: 3 * S })
      title.position.set(W * 0.5, safeTop + 36 * S)
      const floorText = _pool.txt(`第 ${g.floor} 层`, { fontSize: 12 * S, fill: '#aaa', anchor: 0.5 })
      floorText.position.set(W * 0.5, safeTop + 56 * S)

      // Tab 切换
      const tabY = safeTop + 72 * S, tabH = 32 * S, tabW = W * 0.35
      const petTabX = W * 0.1, wpnTabX = W * 0.55
      const isPetTab = g.prepareTab === 'pets'

      const petTabBg = _pool.gfx()
      petTabBg.beginFill(isPetTab ? PR.colorToInt('#f5e6c8') : 0x1e1e2e, isPetTab ? 1 : 0.8)
      petTabBg.drawRoundedRect(petTabX, tabY, tabW, tabH, 6 * S); petTabBg.endFill()
      const petTabLabel = _pool.txt('灵兽编辑', { fontSize: 13 * S, fill: isPetTab ? '#3d2b1f' : '#999', fontWeight: 'bold', anchor: 0.5 })
      petTabLabel.position.set(petTabX + tabW * 0.5, tabY + tabH * 0.5)
      g._prepPetTabRect = [petTabX, tabY, tabW, tabH]

      const wpnTabBg = _pool.gfx()
      wpnTabBg.beginFill(!isPetTab ? PR.colorToInt('#f5e6c8') : 0x1e1e2e, !isPetTab ? 1 : 0.8)
      wpnTabBg.drawRoundedRect(wpnTabX, tabY, tabW, tabH, 6 * S); wpnTabBg.endFill()
      const wpnTabLabel = _pool.txt('法宝切换', { fontSize: 13 * S, fill: !isPetTab ? '#3d2b1f' : '#999', fontWeight: 'bold', anchor: 0.5 })
      wpnTabLabel.position.set(wpnTabX + tabW * 0.5, tabY + tabH * 0.5)
      g._prepWpnTabRect = [wpnTabX, tabY, tabW, tabH]

      const contentY = tabY + tabH + 12 * S
      const padX = 12 * S

      if (isPetTab) {
        _buildPetTab(g, _pool, padX, contentY, ATTR_COLOR, getPetStarAtk, getPetAvatarPath, this, PR, W, H, S, safeTop)
      } else {
        _buildWeaponTab(g, _pool, padX, contentY, this, PR, W, H, S)
      }

      // HP 条
      const hpBarH = 18 * S, hpBarY = H - 60 * S - hpBarH - 12 * S
      _pool.hpBar(padX, hpBarY, W - padX * 2, hpBarH, g.heroHp, g.heroMaxHp, '#d4607a', true)

      // 出发按钮
      const goBtnX = W * 0.2, goBtnY = H - 60 * S, goBtnW = W * 0.6, goBtnH = 46 * S
      _drawButton(_pool, goBtnX, goBtnY, goBtnW, goBtnH, '查看事件', '#f5e6c8', S)
      g._prepGoBtnRect = [goBtnX, goBtnY, goBtnW, goBtnH]

      // Tips 浮层
      _buildTip(g, _pool, ATTR_COLOR, getPetStarAtk, getPetAvatarPath, petHasSkill, getPetSkillDesc, PR, W, H, S, safeTop)

      // 返回按钮
      _drawBackBtn(_pool, g, S, safeTop, W)

      _pool.hideUnused()
    },
  }
}

function _drawButton(pool, x, y, w, h, text, color, S) {
  const PR = pool._deps.PR
  const colorInt = PR.colorToInt(color || '#ffd700')
  const rad = Math.min(10 * S, h / 2)
  const shadow = pool.gfx(); shadow.beginFill(0x000000, 0.25); shadow.drawRoundedRect(x, y + 4 * S, w, h, rad); shadow.endFill()
  const base = pool.gfx(); base.beginFill(PR.darken(colorInt)); base.drawRoundedRect(x, y + 2 * S, w, h, rad); base.endFill()
  const body = pool.gfx(); body.beginFill(colorInt); body.drawRoundedRect(x, y, w, h, rad); body.endFill()
  const glow = pool.gfx(); glow.beginFill(0xffffff, 0.2); glow.drawRoundedRect(x + S, y + S, w - 2 * S, h * 0.5, rad); glow.endFill()
  const label = pool.txt(text, { fontSize: Math.min(14 * S, h * 0.45), fill: '#ffffff', fontWeight: 'bold', anchor: 0.5, stroke: '#000000', strokeThickness: 2 * S })
  label.position.set(x + w / 2, y + h / 2)
}

function _drawBackBtn(pool, g, S, safeTop, W) {
  const btnW = 64 * S, btnH = 30 * S, bx = 8 * S, by = safeTop + 6 * S
  const bg = pool.gfx()
  bg.beginFill(0x281e0f, 0.82); bg.drawRoundedRect(bx, by, btnW, btnH, btnH * 0.5); bg.endFill()
  bg.lineStyle(1 * S, 0xd4af37, 0.5); bg.drawRoundedRect(bx, by, btnW, btnH, btnH * 0.5)
  const label = pool.txt('◁ 首页', { fontSize: 12 * S, fill: '#f0dca0', fontWeight: 'bold', anchor: 0.5, stroke: '#000000', strokeThickness: 2 * S })
  label.position.set(bx + btnW * 0.5, by + btnH * 0.5)
  if (g) g._backBtnRect = [bx, by, btnW, btnH]
}

function _buildPetTab(g, pool, padX, contentY, ATTR_COLOR, getPetStarAtk, getPetAvatarPath, self, PR, W, H, S, safeTop) {
  const subLabel = pool.txt('上场灵兽（5只）：', { fontSize: 12 * S, fill: '#aaa', anchor: { x: 0, y: 0.5 } })
  subLabel.position.set(padX, contentY + 12 * S)

  const slotGap = 4 * S
  const iconSz = Math.floor((W - padX * 2 - slotGap * 4) / 5)
  const textH = 28 * S, slotY = contentY + 20 * S
  const frameScale = 1.12, frameSz = iconSz * frameScale, fOff = (frameSz - iconSz) / 2

  g._prepSlotRects = []
  for (let i = 0; i < 5; i++) {
    const sx = padX + i * (iconSz + slotGap)
    const p = g.pets[i]
    const ac = p ? ATTR_COLOR[p.attr] : null
    const bg = pool.gfx()
    bg.beginFill(p ? PR.colorToInt(ac ? ac.bg : '#1a1a2e') : 0x12121e, p ? 1 : 0.6)
    bg.drawRect(sx + 1, slotY + 1, iconSz - 2, iconSz - 2); bg.endFill()
    if (p) {
      const avSprite = pool.spr(getPetAvatarPath(p))
      avSprite.position.set(sx + 1, slotY + 1); avSprite.width = iconSz - 2; avSprite.height = iconSz - 2
      const fSprite = pool.spr(`assets/ui/frame_pet_${p.attr}.png`)
      fSprite.position.set(sx - fOff, slotY - fOff); fSprite.width = frameSz; fSprite.height = frameSz
      if ((p.star || 1) >= 1) {
        const star = pool.txt('★'.repeat(p.star || 1), { fontSize: iconSz * 0.14, fill: '#ffd700', fontWeight: 'bold', anchor: { x: 0, y: 1 }, stroke: '#000', strokeThickness: 2 * S })
        star.position.set(sx + 2 * S, slotY + iconSz - 2 * S)
      }
      if (g.prepareSelSlotIdx === i) {
        const sel = pool.gfx(); sel.lineStyle(2.5 * S, PR.colorToInt('#f5e6c8'))
        sel.drawRect(sx - 1, slotY - 1, iconSz + 2, iconSz + 2)
      }
      const name = pool.txt(p.name.substring(0, 5), { fontSize: 9 * S, fill: ac ? ac.main : '#eee', fontWeight: 'bold', anchor: 0.5 })
      name.position.set(sx + iconSz * 0.5, slotY + iconSz + 8 * S)
      const pStarAtk = getPetStarAtk(p)
      const atkDisp = (p.star || 1) > 1 ? `ATK:${p.atk}→${pStarAtk}` : `ATK:${p.atk}`
      const atk = pool.txt(atkDisp, { fontSize: 8 * S, fill: '#888', anchor: 0.5 })
      atk.position.set(sx + iconSz * 0.5, slotY + iconSz + 19 * S)
    } else {
      const fSprite = pool.spr('assets/ui/frame_pet_metal.png')
      fSprite.position.set(sx - fOff, slotY - fOff); fSprite.width = frameSz; fSprite.height = frameSz; fSprite.alpha = 0.35
    }
    g._prepSlotRects.push([sx, slotY, iconSz, iconSz + textH])
  }

  // 背包区
  const bagLabelY = slotY + iconSz + textH + 30 * S
  const bagLabel = pool.txt(`灵兽背包（${g.petBag.length}只）：`, { fontSize: 12 * S, fill: '#aaa', anchor: { x: 0, y: 0.5 } })
  bagLabel.position.set(padX, bagLabelY)

  const bagY = bagLabelY + 16 * S, bagGap = 4 * S
  const bagIcon = Math.floor((W - padX * 2 - bagGap * 3) / 4)
  const bagTextH = 28 * S, bagH = bagIcon + bagTextH
  const bFrameSz = bagIcon * frameScale, bfOff = (bFrameSz - bagIcon) / 2

  const bagBottomLimit = H - 60 * S - 18 * S - 12 * S - 58 * S
  const bagViewH = bagBottomLimit - bagY
  const bagRows = Math.ceil(Math.max(g.petBag.length, 1) / 4)
  const bagContentH = bagRows * (bagH + bagGap)
  const maxScroll = Math.max(0, bagContentH - bagViewH)
  if (self._petBagScrollY < 0) self._petBagScrollY = 0
  if (self._petBagScrollY > maxScroll) self._petBagScrollY = maxScroll
  g._prepBagScrollArea = [0, bagY, W, bagViewH]

  // 用 mask 裁剪背包区（mask 需要保留，但可以用 pool.gfx 复用）
  const mask = pool.gfx()
  mask.beginFill(0xffffff); mask.drawRect(0, bagY, W, bagViewH); mask.endFill()

  // 背包内容需要偏移（通过改变绘制坐标实现，避免 Container 嵌套）
  const scrollOff = -self._petBagScrollY

  g._prepBagRects = []
  for (let i = 0; i < Math.max(g.petBag.length, 1); i++) {
    const bx = padX + (i % 4) * (bagIcon + bagGap)
    const by = bagY + Math.floor(i / 4) * (bagH + bagGap) + scrollOff
    // 跳过不可见的行
    if (by + bagH < bagY || by > bagY + bagViewH) {
      g._prepBagRects.push([bx, by, bagIcon, bagH])
      continue
    }
    const bp = g.petBag[i]
    const ac = bp ? ATTR_COLOR[bp.attr] : null
    const bbg = pool.gfx()
    bbg.beginFill(bp ? PR.colorToInt(ac ? ac.bg : '#1a1a2e') : 0x12121e, bp ? 1 : 0.6)
    bbg.drawRect(bx + 1, by + 1, bagIcon - 2, bagIcon - 2); bbg.endFill()
    if (bp) {
      const avSprite = pool.spr(getPetAvatarPath(bp))
      avSprite.position.set(bx + 1, by + 1); avSprite.width = bagIcon - 2; avSprite.height = bagIcon - 2
      const fSprite = pool.spr(`assets/ui/frame_pet_${bp.attr}.png`)
      fSprite.position.set(bx - bfOff, by - bfOff); fSprite.width = bFrameSz; fSprite.height = bFrameSz
      if ((bp.star || 1) >= 1) {
        const star = pool.txt('★'.repeat(bp.star || 1), { fontSize: bagIcon * 0.14, fill: '#ffd700', fontWeight: 'bold', anchor: { x: 0, y: 1 }, stroke: '#000', strokeThickness: 2 * S })
        star.position.set(bx + 2 * S, by + bagIcon - 2 * S)
      }
      if (g.prepareSelBagIdx === i) {
        const sel = pool.gfx(); sel.lineStyle(2.5 * S, PR.colorToInt('#f5e6c8'))
        sel.drawRect(bx - 1, by - 1, bagIcon + 2, bagIcon + 2)
      }
      const name = pool.txt(bp.name.substring(0, 5), { fontSize: 9 * S, fill: ac ? ac.main : '#eee', fontWeight: 'bold', anchor: 0.5 })
      name.position.set(bx + bagIcon * 0.5, by + bagIcon + 8 * S)
      const bpStarAtk = getPetStarAtk(bp)
      const atkDisp = (bp.star || 1) > 1 ? `ATK:${bp.atk}→${bpStarAtk}` : `ATK:${bp.atk}`
      const atkLabel = pool.txt(atkDisp, { fontSize: 8 * S, fill: '#888', anchor: 0.5 })
      atkLabel.position.set(bx + bagIcon * 0.5, by + bagIcon + 19 * S)
    } else {
      const fSprite = pool.spr('assets/ui/frame_pet_metal.png')
      fSprite.position.set(bx - bfOff, by - bfOff); fSprite.width = bFrameSz; fSprite.height = bFrameSz; fSprite.alpha = 0.35
      const emptyText = pool.txt('空', { fontSize: 10 * S, fill: '#666', anchor: 0.5 })
      emptyText.position.set(bx + bagIcon * 0.5, by + bagIcon * 0.5)
    }
    g._prepBagRects.push([bx, by, bagIcon, bagH])
  }

  // 交换按钮
  if (g.prepareSelSlotIdx >= 0 && g.prepareSelBagIdx >= 0 && g.petBag[g.prepareSelBagIdx]) {
    const swapBtnY = bagY + bagRows * (bagH + bagGap) + scrollOff + 8 * S
    const swapBtnX = W * 0.25, swapBtnW = W * 0.5, swapBtnH = 38 * S
    _drawButton(pool, swapBtnX, swapBtnY, swapBtnW, swapBtnH, '交换上场', '#f5e6c8', S)
    g._prepSwapBtnRect = [swapBtnX, swapBtnY, swapBtnW, swapBtnH]
  } else { g._prepSwapBtnRect = null }

  // 滚动条
  if (bagContentH > bagViewH && maxScroll > 0) {
    const barH2 = Math.max(20 * S, bagViewH * (bagViewH / bagContentH))
    const scrollRatio = self._petBagScrollY / maxScroll
    const barY2 = bagY + scrollRatio * (bagViewH - barH2)
    const sb = pool.gfx(); sb.beginFill(0xffffff, 0.3)
    sb.drawRoundedRect(W - 6 * S, barY2, 4 * S, barH2, 2 * S); sb.endFill()
  }
}

function _buildWeaponTab(g, pool, padX, contentY, self, PR, W, H, S) {
  const drag = g._prepDragWpn
  const subLabel = pool.txt('当前法宝：', { fontSize: 12 * S, fill: '#aaa', anchor: { x: 0, y: 0.5 } })
  subLabel.position.set(padX, contentY + 12 * S)

  const curWpnY = contentY + 20 * S
  const curIconSz = Math.floor((W - padX * 2 - 4 * S * 4) / 5)
  const curTextH = 28 * S

  if (g.weapon) {
    const sx = padX, sy = curWpnY
    const isDragSrc = drag && drag.source === 'equipped'
    const bgAlpha = isDragSrc ? 0.3 : 1
    const bg = pool.gfx(); bg.beginFill(0x1e1912, 0.85)
    bg.drawRect(sx + 1, sy + 1, curIconSz - 2, curIconSz - 2); bg.endFill(); bg.alpha = bgAlpha
    const wSprite = pool.spr(`assets/equipment/fabao_${g.weapon.id}.png`)
    wSprite.position.set(sx + 1, sy + 1); wSprite.width = curIconSz - 2; wSprite.height = curIconSz - 2; wSprite.alpha = bgAlpha
    const frame = pool.gfx(); frame.lineStyle(2 * S, 0xffd700, 0.7)
    frame.drawRoundedRect(sx - 1, sy - 1, curIconSz + 2, curIconSz + 2, 3 * S); frame.alpha = bgAlpha
    const wName = pool.txt(`法宝·${g.weapon.name.substring(0, 4)}`, { fontSize: 9 * S, fill: '#e0a020', fontWeight: 'bold', anchor: 0.5 })
    wName.position.set(sx + curIconSz * 0.5, sy + curIconSz + 10 * S); wName.alpha = bgAlpha
    if (drag && drag.source === 'bag' && g._hitRect && g._hitRect(drag.x, drag.y, sx, sy, curIconSz, curIconSz)) {
      const hl = pool.gfx(); hl.lineStyle(2.5 * S, 0xffd700)
      hl.drawRect(sx - 1, sy - 1, curIconSz + 2, curIconSz + 2)
    }
  } else {
    const bg = pool.gfx(); bg.beginFill(0x222233, 0.6)
    bg.drawRoundedRect(padX, curWpnY, curIconSz, curIconSz, 6 * S); bg.endFill()
    const frame = pool.gfx(); frame.lineStyle(1.5 * S, 0xffd700, 0.35)
    frame.drawRoundedRect(padX - 1, curWpnY - 1, curIconSz + 2, curIconSz + 2, 3 * S)
    const emptyText = pool.txt('无', { fontSize: 10 * S, fill: '#666', anchor: 0.5 })
    emptyText.position.set(padX + curIconSz * 0.5, curWpnY + curIconSz * 0.5)
  }
  g._prepCurWpnRect = [padX, curWpnY, curIconSz, curIconSz + curTextH]

  // 法宝背包
  const wBagLabelY = curWpnY + curIconSz + curTextH + 14 * S
  const wBagLabel = pool.txt(`背包法宝（${g.weaponBag.length}件）：`, { fontSize: 12 * S, fill: '#aaa', anchor: { x: 0, y: 0.5 } })
  wBagLabel.position.set(padX, wBagLabelY)
  const hintText = pool.txt('拖动到上方可替换装备', { fontSize: 9 * S, fill: 'rgba(200,180,140,0.5)', anchor: 0.5 })
  hintText.position.set(W * 0.5, wBagLabelY + 13 * S)

  const wBagY = wBagLabelY + 28 * S, bagGap = 4 * S
  const bagIcon = Math.floor((W - padX * 2 - bagGap * 3) / 4), bagTextH = 28 * S
  const wBagBottomLimit = H - 60 * S - 18 * S - 12 * S - 58 * S
  const wBagViewH = wBagBottomLimit - wBagY
  const wBagRows = Math.max(Math.ceil(g.weaponBag.length / 4), 1)
  const wBagContentH = wBagRows * (bagIcon + bagTextH + bagGap)
  const wMaxScroll = Math.max(0, wBagContentH - wBagViewH)
  if (self._wpnBagScrollY < 0) self._wpnBagScrollY = 0
  if (self._wpnBagScrollY > wMaxScroll) self._wpnBagScrollY = wMaxScroll
  g._prepWpnBagScrollArea = [0, wBagY, W, wBagViewH]

  const scrollOff = -self._wpnBagScrollY

  g._prepWpnBagRects = []
  for (let i = 0; i < g.weaponBag.length; i++) {
    const bx = padX + (i % 4) * (bagIcon + bagGap)
    const by = wBagY + Math.floor(i / 4) * (bagIcon + bagTextH + bagGap) + scrollOff
    if (by + bagIcon + bagTextH < wBagY || by > wBagY + wBagViewH) {
      g._prepWpnBagRects.push([bx, by, bagIcon, bagIcon + bagTextH])
      continue
    }
    const wp = g.weaponBag[i]
    const isDragSrc = drag && drag.source === 'bag' && drag.index === i
    const alpha = isDragSrc ? 0.3 : 1
    const wbg = pool.gfx(); wbg.beginFill(0x1e1912, 0.85)
    wbg.drawRect(bx + 1, by + 1, bagIcon - 2, bagIcon - 2); wbg.endFill(); wbg.alpha = alpha
    const wSprite = pool.spr(`assets/equipment/fabao_${wp.id}.png`)
    wSprite.position.set(bx + 1, by + 1); wSprite.width = bagIcon - 2; wSprite.height = bagIcon - 2; wSprite.alpha = alpha
    const wFrame = pool.gfx(); wFrame.lineStyle(2 * S, 0xffd700, 0.7)
    wFrame.drawRoundedRect(bx - 1, by - 1, bagIcon + 2, bagIcon + 2, 3 * S); wFrame.alpha = alpha
    const wName = pool.txt(`法宝·${wp.name.substring(0, 4)}`, { fontSize: 9 * S, fill: '#e0a020', fontWeight: 'bold', anchor: 0.5 })
    wName.position.set(bx + bagIcon * 0.5, by + bagIcon + 10 * S); wName.alpha = alpha
    g._prepWpnBagRects.push([bx, by, bagIcon, bagIcon + bagTextH])
    if (drag && drag.source === 'equipped' && g._hitRect && g._hitRect(drag.x, drag.y, bx, by, bagIcon, bagIcon)) {
      const hl = pool.gfx(); hl.lineStyle(2.5 * S, 0xffd700)
      hl.drawRect(bx - 1, by - 1, bagIcon + 2, bagIcon + 2)
    }
  }
  if (g.weaponBag.length === 0) {
    const emptyText = pool.txt('背包空空如也', { fontSize: 12 * S, fill: '#666', anchor: 0.5 })
    emptyText.position.set(W * 0.5, wBagY + 20 * S)
  }

  if (wBagContentH > wBagViewH && wMaxScroll > 0) {
    const barH2 = Math.max(20 * S, wBagViewH * (wBagViewH / wBagContentH))
    const scrollRatio = self._wpnBagScrollY / wMaxScroll
    const barY2 = wBagY + scrollRatio * (wBagViewH - barH2)
    const sb = pool.gfx(); sb.beginFill(0xffffff, 0.3)
    sb.drawRoundedRect(W - 6 * S, barY2, 4 * S, barH2, 2 * S); sb.endFill()
  }

  // 拖拽中的法宝
  if (drag && drag.weapon && drag.moved) {
    const dragSz = curIconSz * 0.9
    const dx = drag.x - dragSz / 2, dy = drag.y - dragSz / 2
    const dbg = pool.gfx(); dbg.beginFill(0x1e1912, 0.85)
    dbg.drawRect(dx + 1, dy + 1, dragSz - 2, dragSz - 2); dbg.endFill(); dbg.alpha = 0.85
    const dSprite = pool.spr(`assets/equipment/fabao_${drag.weapon.id}.png`)
    dSprite.position.set(dx + 1, dy + 1); dSprite.width = dragSz - 2; dSprite.height = dragSz - 2; dSprite.alpha = 0.85
    const dFrame = pool.gfx(); dFrame.lineStyle(2 * S, 0xffd700, 0.7)
    dFrame.drawRoundedRect(dx - 1, dy - 1, dragSz + 2, dragSz + 2, 3 * S); dFrame.alpha = 0.85
  }
}

function _buildTip(g, pool, ATTR_COLOR, getPetStarAtk, getPetAvatarPath, petHasSkill, getPetSkillDesc, PR, W, H, S, safeTop) {
  const tip = g.prepareTip
  if (!tip || !tip.data) { g._prepTipOverlay = false; return }
  // 半透明遮罩
  const ov = pool.gfx()
  ov.beginFill(0x000000, 0.35); ov.drawRect(0, 0, W, H); ov.endFill()
  g._prepTipOverlay = true
  const d = tip.data
  const tipW = W * 0.8
  const padXt = 14 * S, padYt = 10 * S

  if (tip.type === 'pet') {
    const curStar = d.star || 1, curAtk = getPetStarAtk(d)
    const totalH = 120 * S
    const tipX = (W - tipW) / 2
    const tipY = Math.min(Math.max(tip.y - totalH - 10 * S, safeTop + 10 * S), H - totalH - 80 * S)
    // panel bg
    const p = pool.gfx(); p.beginFill(0xf8f2e6, 0.95); p.drawRoundedRect(tipX, tipY, tipW, totalH, 14 * S); p.endFill()
    p.lineStyle(1.5 * S, 0xc9a84c, 0.4); p.drawRoundedRect(tipX, tipY, tipW, totalH, 14 * S)
    const nameText = pool.txt(`${d.name} ${'★'.repeat(curStar)}`, { fontSize: 14 * S, fill: '#3D2B1F', fontWeight: 'bold', anchor: { x: 0, y: 0 } })
    nameText.position.set(tipX + padXt, tipY + padYt + 4 * S)
    const atkText = pool.txt(`ATK: ${curAtk}`, { fontSize: 11 * S, fill: '#c06020', fontWeight: 'bold', anchor: { x: 0, y: 0 } })
    atkText.position.set(tipX + padXt, tipY + padYt + 24 * S)
    if (petHasSkill(d)) {
      const skillTitle = pool.txt(`技能：${d.skill.name}  CD ${d.cd}`, { fontSize: 11 * S, fill: '#8B6914', fontWeight: 'bold', anchor: { x: 0, y: 0 } })
      skillTitle.position.set(tipX + padXt, tipY + padYt + 44 * S)
      const skillDesc = getPetSkillDesc(d) || ''
      if (skillDesc) {
        const descText = pool.txt(skillDesc, { fontSize: 10 * S, fill: '#3D2B1F', anchor: { x: 0, y: 0 }, wordWrap: true, wordWrapWidth: tipW - padXt * 2 })
        descText.position.set(tipX + padXt, tipY + padYt + 62 * S)
      }
    } else {
      const noSkill = pool.txt('技能：升至★2解锁', { fontSize: 11 * S, fill: '#8B7B70', fontWeight: 'bold', anchor: { x: 0, y: 0 } })
      noSkill.position.set(tipX + padXt, tipY + padYt + 44 * S)
    }
    const closeHint = pool.txt('点击任意位置关闭', { fontSize: 9 * S, fill: '#9B8B80', anchor: 0.5 })
    closeHint.position.set(W * 0.5, tipY + totalH + 14 * S)
  } else if (tip.type === 'weapon') {
    const totalH = 80 * S
    const tipX = (W - tipW) / 2
    const tipY = Math.min(Math.max(tip.y - totalH - 10 * S, safeTop + 10 * S), H - totalH - 80 * S)
    const p = pool.gfx(); p.beginFill(0xf8f2e6, 0.95); p.drawRoundedRect(tipX, tipY, tipW, totalH, 14 * S); p.endFill()
    p.lineStyle(1.5 * S, 0xc9a84c, 0.4); p.drawRoundedRect(tipX, tipY, tipW, totalH, 14 * S)
    const wpnName = pool.txt(`法宝·${d.name}`, { fontSize: 14 * S, fill: '#8B6914', fontWeight: 'bold', anchor: { x: 0, y: 0 } })
    wpnName.position.set(tipX + padXt, tipY + padYt + 4 * S)
    if (d.desc) {
      const descText = pool.txt(d.desc, { fontSize: 10 * S, fill: '#3D2B1F', anchor: { x: 0, y: 0 }, wordWrap: true, wordWrapWidth: tipW - padXt * 2 })
      descText.position.set(tipX + padXt, tipY + padYt + 28 * S)
    }
    const closeHint = pool.txt('点击任意位置关闭', { fontSize: 9 * S, fill: '#9B8B80', anchor: 0.5 })
    closeHint.position.set(W * 0.5, tipY + totalH + 14 * S)
  }
}

module.exports = { createPrepareBuilder }
