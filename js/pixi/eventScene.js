/**
 * Event 场景原生 PixiJS 构建器
 * 【性能优化版】对象池复用，避免每帧创建/销毁对象
 * 战斗/奇遇/商店/休息 事件预览界面
 */
const PIXI = require('../libs/pixi-wrapper')
const { FramePool } = require('./ObjectPool')

function createEventBuilder(deps) {
  const { SceneManager, PR, W, H, S, safeTop, AssetManager } = deps
  let _lastFloor = -1, _scrollY = 0

  let _pool = null
  let _layer = null
  let _bgLayer = null
  let _bgBuilt = false
  let _bgKey = ''  // 背景key（不同事件类型用不同背景）

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
    build(g) { this._built = true; _bgBuilt = false; _bgLayer = null; _layer = null; _pool = null; _bgKey = '' },
    update(g) {
      const scene = SceneManager.getScene('event')
      if (!scene) return
      _ensureLayers(scene)
      const { ATTR_COLOR, ATTR_NAME, COUNTER_BY, COUNTER_MAP, getRealmInfo } = require('../data/tower')
      const { getPetStarAtk, MAX_STAR, getPetAvatarPath, getPetSkillDesc, petHasSkill } = require('../data/pets')
      const { wrapText } = require('../views/prepareView')
      const ev = g.curEvent
      if (!ev) return

      // 背景：根据事件类型缓存
      const newBgKey = ev.type + '_' + (g.floor || 0)
      if (!_bgBuilt || _bgKey !== newBgKey) {
        _bgLayer.removeChildren()
        const bgMap = { battle: 'bg_reward.jpg', elite: 'bg_reward.jpg', boss: 'bg_reward.jpg', adventure: 'bg_adventure.jpg', shop: 'bg_shop.jpg', rest: 'bg_rest.jpg' }
        const bgFile = bgMap[ev.type] || 'bg_reward.jpg'
        const overlayMap = { adventure: 0.3, shop: 0.3, rest: 0.3 }
        _bgLayer.addChild(PR.createSceneBg({ bgColor: '#0c0818', bgImage: `assets/backgrounds/${bgFile}`, overlay: '#050510', overlayAlpha: overlayMap[ev.type] || 0.45 }))
        _bgBuilt = true; _bgKey = newBgKey
      }

      const padX = 12 * S
      const isBattle = ev.type === 'battle' || ev.type === 'elite' || ev.type === 'boss'
      if (g.floor !== _lastFloor) { _scrollY = 0; _lastFloor = g.floor }

      _pool.reset()

      let curY = safeTop + 32 * S
      // 楼层标签
      const floorLabel = _pool.spr('assets/ui/floor_label_bg.png')
      const flLW = W * 0.45, flLH = flLW / 4
      floorLabel.position.set((W - flLW) / 2, curY - flLH * 0.7); floorLabel.width = flLW; floorLabel.height = flLH
      const flText = _pool.txt(`第 ${g.floor} 层`, { fontSize: 18 * S, fill: '#f5e6c8', fontWeight: 'bold', anchor: 0.5, dropShadow: true, dropShadowColor: '#000', dropShadowBlur: 4 * S, dropShadowDistance: 0 })
      flText.position.set(W * 0.5, curY)
      curY += 28 * S

      // 事件类型标签
      const typeName = { battle: '普通战斗', elite: '精英战斗', boss: 'BOSS挑战', adventure: '奇遇', shop: '神秘商店', rest: '休息之地' }
      const evLabel = typeName[ev.type] || '未知事件'
      _drawEventTypeTag(_pool, ev.type, evLabel, curY, PR, W, S)
      curY += 18 * S
      if (g._realmUpInfo) g._realmUpInfo = null

      // 重置触摸区
      g._eventPetRects = []; g._eventEditPetRect = null; g._eventEditWpnRect = null
      g._eventWpnSlots = []; g._eventPetSlots = []; g._eventBagPetRects = []

      if (!isBattle) {
        _buildNonBattle(_pool, g, ev, curY, ATTR_COLOR, PR, W, H, S, safeTop, getPetStarAtk, getPetAvatarPath)
      } else {
        _buildBattle(_pool, g, ev, curY, padX, ATTR_COLOR, ATTR_NAME, COUNTER_BY, COUNTER_MAP, getRealmInfo, getPetStarAtk, getPetAvatarPath, wrapText, petHasSkill, getPetSkillDesc, MAX_STAR, PR, W, H, S, safeTop)
      }

      _pool.hideUnused()
    }
  }
}

function _drawEventTypeTag(pool, type, label, curY, PR, W, S) {
  if (type === 'boss') {
    const tW = 140 * S, tH = 28 * S, tX = (W - tW) / 2, tY = curY - 17 * S
    const bg = pool.gfx(); bg.beginFill(0xb41e1e, 0.85); bg.drawRoundedRect(tX, tY, tW, tH, 6 * S); bg.endFill()
    bg.lineStyle(1.5 * S, 0xffd700); bg.drawRoundedRect(tX, tY, tW, tH, 6 * S)
    const t = pool.txt('⚠ ' + label + ' ⚠', { fontSize: 15 * S, fill: '#ffd700', fontWeight: 'bold', anchor: 0.5 })
    t.position.set(W * 0.5, curY)
  } else if (type === 'elite') {
    const tW = 120 * S, tH = 26 * S, tX = (W - tW) / 2, tY = curY - 16 * S
    const bg = pool.gfx(); bg.beginFill(0x7832b4, 0.8); bg.drawRoundedRect(tX, tY, tW, tH, 6 * S); bg.endFill()
    bg.lineStyle(1, 0xc896ff, 0.6); bg.drawRoundedRect(tX, tY, tW, tH, 6 * S)
    const t = pool.txt('★ ' + label, { fontSize: 14 * S, fill: '#e0c0ff', fontWeight: 'bold', anchor: 0.5 })
    t.position.set(W * 0.5, curY)
  } else {
    const t = pool.txt(label, { fontSize: 14 * S, fill: '#e8d8b8', fontWeight: 'bold', anchor: 0.5, dropShadow: true, dropShadowColor: '#000', dropShadowBlur: 3 * S, dropShadowDistance: 0 })
    t.position.set(W * 0.5, curY)
  }
}

function _drawBadge(pool, x, y, size, text, bgColor, PR, S) {
  const bW = text.length > 2 ? 20 * S : 16 * S, bH = 10 * S
  const bX = x + size - bW - S, bY = y + S
  const bg = pool.gfx(); bg.beginFill(PR.colorToInt(bgColor)); bg.drawRoundedRect(bX, bY, bW, bH, 3 * S); bg.endFill()
  const l = pool.txt(text, { fontSize: 7 * S, fill: '#fff', fontWeight: 'bold', anchor: 0.5 })
  l.position.set(bX + bW / 2, bY + bH / 2)
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

function _drawDarkCard(pool, x, y, w, h, r, S) {
  const rad = r || 10 * S
  const g = pool.gfx()
  g.beginFill(0x1e1912, 0.9); g.drawRoundedRect(x, y, w, h, rad); g.endFill()
  g.lineStyle(1 * S, 0xd4af37, 0.3); g.drawRoundedRect(x, y, w, h, rad)
}

function _drawInfoPanel(pool, x, y, w, h, S) {
  const g = pool.gfx()
  g.beginFill(0xf8f2e6, 0.95); g.drawRoundedRect(x, y, w, h, 14 * S); g.endFill()
  g.lineStyle(1.5 * S, 0xc9a84c, 0.4); g.drawRoundedRect(x, y, w, h, 14 * S)
}

// ===== 非战斗事件 =====
function _buildNonBattle(pool, g, ev, curY, ATTR_COLOR, PR, W, H, S, safeTop, getPetStarAtk, getPetAvatarPath) {
  if (ev.type === 'adventure') {
    if (!g._adventureApplied) { g._applyAdventure(ev.data); g._adventureApplied = true }
    let ty = safeTop + 32 * S
    pool.txt(`── 第 ${g.floor} 层 ──`, { fontSize: 18 * S, fill: '#f5e6c8', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, ty)
    ty += 22 * S; pool.txt('奇遇', { fontSize: 14 * S, fill: '#e0d0b0', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, ty)
    pool.txt(ev.data.name, { fontSize: 18 * S, fill: '#fff', fontWeight: 'bold', anchor: 0.5, dropShadow: true, dropShadowColor: '#000', dropShadowBlur: 4 * S, dropShadowDistance: 0 }).position.set(W * 0.5, H * 0.35)
    pool.txt(ev.data.desc, { fontSize: 14 * S, fill: '#f0e8d8', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, H * 0.43)
    if (g._adventureResult) pool.txt(g._adventureResult, { fontSize: 15 * S, fill: '#ffd54f', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, H * 0.50)
    pool.txt('效果已生效！', { fontSize: 14 * S, fill: '#5ddd5d', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, g._adventureResult ? H * 0.57 : H * 0.52)
    const bx = W * 0.3, by = H * 0.65, bw = W * 0.4, bh = 44 * S
    _drawButton(pool, bx, by, bw, bh, '继续', '#f5e6c8', S)
    g._eventBtnRect = [bx, by, bw, bh]; _drawBackBtn(pool, g, S, safeTop, W); return
  }
  if (ev.type === 'shop') { _buildShop(pool, g, ev, curY, ATTR_COLOR, PR, W, H, S, safeTop, getPetStarAtk, getPetAvatarPath); return }
  if (ev.type === 'rest') {
    let ty = safeTop + 32 * S
    pool.txt(`── 第 ${g.floor} 层 ──`, { fontSize: 18 * S, fill: '#f5e6c8', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, ty)
    ty += 22 * S; pool.txt('休息之地', { fontSize: 14 * S, fill: '#e0d0b0', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, ty)
    const opts = ev.data; g._eventRestRects = []
    if (opts) { const cardW = W * 0.7, cardH = 65 * S, gap = 16 * S, startY = H * 0.3
      opts.forEach((opt, i) => { const cy = startY + i * (cardH + gap)
        _drawDarkCard(pool, W * 0.15, cy, cardW, cardH, 8 * S, S)
        pool.txt(opt.name, { fontSize: 15 * S, fill: '#e0d0b0', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, cy + 28 * S)
        pool.txt(opt.desc, { fontSize: 12 * S, fill: '#999', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, cy + 48 * S)
        g._eventRestRects.push([W * 0.15, cy, cardW, cardH])
      })
    }
    g._eventBtnRect = null; _drawBackBtn(pool, g, S, safeTop, W); return
  }
  const gBW = W * 0.55, gBH = 44 * S, gBX = (W - gBW) / 2
  _drawButton(pool, gBX, curY, gBW, gBH, '进入', '#f5e6c8', S)
  g._eventBtnRect = [gBX, curY, gBW, gBH]; _drawBackBtn(pool, g, S, safeTop, W)
}

// ===== 商店 =====
function _buildShop(pool, g, ev, curY, ATTR_COLOR, PR, W, H, S, safeTop, getPetStarAtk, getPetAvatarPath) {
  let ty = safeTop + 32 * S
  pool.txt(`── 第 ${g.floor} 层 ──`, { fontSize: 18 * S, fill: '#f5e6c8', fontWeight: 'bold', anchor: 0.5, dropShadow: true, dropShadowColor: '#000', dropShadowBlur: 3 * S, dropShadowDistance: 0 }).position.set(W * 0.5, ty)
  ty += 22 * S
  pool.txt('神秘商店', { fontSize: 14 * S, fill: '#e8d0a0', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, ty)

  const shopUsed = g._eventShopUsedCount || 0
  let hText = shopUsed === 0 ? '免费选择一件' : shopUsed === 1 ? '再选一件需消耗15%当前血量' : '已选完'
  if (g._shopSelectAttr) hText = '请选择属性'
  else if (g._shopSelectPet) hText = '请选择目标灵兽'
  const hColor = shopUsed >= 2 ? '#b4a082' : '#ffd080'
  pool.txt(hText, { fontSize: 12 * S, fill: hColor, fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, safeTop + 90 * S)

  const items = ev.data
  if (items && !g._shopSelectAttr && !g._shopSelectPet) {
    const cardW = W * 0.84, cardH = 60 * S, gap = 8 * S, startY = safeTop + 116 * S
    g._eventShopRects = []
    items.forEach((item, i) => {
      const cy = startY + i * (cardH + gap)
      const isUsed = g._eventShopUsedItems && g._eventShopUsedItems.includes(i)
      const canBuy = !isUsed && shopUsed < 2
      const bg = pool.gfx()
      bg.beginFill(isUsed ? 0x32281e : 0x3c2d1e, isUsed ? 0.6 : 0.82)
      bg.drawRoundedRect(W * 0.08, cy, cardW, cardH, 8 * S); bg.endFill()
      bg.lineStyle(S, isUsed ? 0x786446 : 0xc8aa6e, isUsed ? 0.25 : 0.4)
      bg.drawRoundedRect(W * 0.08, cy, cardW, cardH, 8 * S)
      const a = isUsed ? 0.4 : 1
      const nl = pool.txt(item.name, { fontSize: 13 * S, fill: isUsed ? '#b4a082' : '#f5e6c8', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
      nl.position.set(W * 0.08 + 14 * S, cy + 24 * S); nl.alpha = a
      const dl = pool.txt(item.desc, { fontSize: 10 * S, fill: isUsed ? '#b4a082' : '#dcc8aa', anchor: { x: 0, y: 0.5 } })
      dl.position.set(W * 0.08 + 14 * S, cy + 42 * S); dl.alpha = a
      let ct = isUsed ? '已选' : shopUsed === 0 ? '免费' : shopUsed === 1 ? '-15%血' : ''
      if (ct) { const cl = pool.txt(ct, { fontSize: 11 * S, fill: isUsed ? '#b4a082' : shopUsed === 0 ? '#e0c060' : '#e07050', fontWeight: 'bold', anchor: { x: 1, y: 0.5 } })
        cl.position.set(W * 0.08 + cardW - 12 * S, cy + 34 * S); cl.alpha = a }
      g._eventShopRects.push(canBuy ? [W * 0.08, cy, cardW, cardH] : null)
    })
  }

  if (g._shopSelectAttr) _buildAttrPanel(pool, g, ATTR_COLOR, PR, W, H, S)
  if (g._shopSelectPet) _buildPetSelectPanel(pool, g, ATTR_COLOR, getPetStarAtk, getPetAvatarPath, PR, W, H, S)

  if (!g._shopSelectAttr && !g._shopSelectPet) {
    const bx = W * 0.3, by = H * 0.88, bw = W * 0.4, bh = 40 * S
    _drawButton(pool, bx, by, bw, bh, '离开', '#b08840', S)
    g._eventBtnRect = [bx, by, bw, bh]
  } else { g._eventBtnRect = null }
  _drawBackBtn(pool, g, S, safeTop, W)
}

function _buildAttrPanel(pool, g, ATTR_COLOR, PR, W, H, S) {
  const ov = pool.gfx(); ov.beginFill(0x000000, 0.55); ov.drawRect(0, 0, W, H); ov.endFill()
  const sel = g._shopAttrSelectedVal, hasSel = !!sel
  const pW = W * 0.8, pH = hasSel ? 190 * S : 160 * S, pX = (W - pW) / 2, pY = H * 0.33
  _drawInfoPanel(pool, pX, pY, pW, pH, S)
  pool.txt('选择灵兽属性', { fontSize: 14 * S, fill: '#5C3A1E', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, pY + 28 * S)
  const attrs = ['metal', 'wood', 'water', 'fire', 'earth']
  const attrN = { metal: '金', wood: '木', water: '水', fire: '火', earth: '土' }
  const bW = 48 * S, bH = 48 * S, bG = 8 * S, totW = 5 * bW + 4 * bG, stX = (W - totW) / 2, bY = pY + 52 * S
  g._shopAttrRects = []
  attrs.forEach((attr, i) => {
    const bx = stX + i * (bW + bG), ac = ATTR_COLOR[attr], isSel = sel === attr
    const bg = pool.gfx(); bg.beginFill(isSel ? 0xfff5dc : 0xf5ebd7, isSel ? 0.85 : 0.6)
    bg.drawRoundedRect(bx, bY, bW, bH, 8 * S); bg.endFill()
    bg.lineStyle(isSel ? 3 * S : 1.5 * S, isSel ? 0xffd700 : (ac ? PR.colorToInt(ac.main) : 0x999999))
    bg.drawRoundedRect(bx, bY, bW, bH, 8 * S)
    const orb = pool.bead(attr, 20 * S); orb.position.set(bx + bW / 2, bY + bH * 0.35)
    pool.txt(attrN[attr], { fontSize: 10 * S, fill: ac ? ac.dk : '#666', fontWeight: 'bold', anchor: 0.5 }).position.set(bx + bW / 2, bY + bH * 0.82)
    g._shopAttrRects.push([bx, bY, bW, bH, attr])
  })
  const abY = bY + bH + 16 * S
  if (hasSel) {
    const cW = 80 * S, cH = 32 * S, gap = 20 * S, tot = cW * 2 + gap, sx = (W - tot) / 2
    _drawButton(pool, sx, abY, cW, cH, '取消', '#a0896a', S); g._shopAttrCancelRect = [sx, abY, cW, cH]
    _drawButton(pool, sx + cW + gap, abY, cW, cH, '确定', '#b08840', S); g._shopAttrConfirmRect = [sx + cW + gap, abY, cW, cH]
  } else {
    const cW = 80 * S, cH = 32 * S
    _drawButton(pool, (W - cW) / 2, abY, cW, cH, '取消', '#a0896a', S)
    g._shopAttrCancelRect = [(W - cW) / 2, abY, cW, cH]; g._shopAttrConfirmRect = null
  }
}

function _buildPetSelectPanel(pool, g, ATTR_COLOR, getPetStarAtk, getPetAvatarPath, PR, W, H, S) {
  const ov = pool.gfx(); ov.beginFill(0x000000, 0.55); ov.drawRect(0, 0, W, H); ov.endFill()
  const selIdx = g._shopPetSelectedIdx, hasSel = selIdx != null
  const pW = W * 0.85, pH = hasSel ? 266 * S : 206 * S, pX = (W - pW) / 2, pY = H * 0.22
  _drawInfoPanel(pool, pX, pY, pW, pH, S)
  const sType = g._shopSelectPet.type
  const tMap = { starUp: '选择灵兽升星', upgradePet: '选择灵兽强化', cdReduce: '选择灵兽减CD' }
  pool.txt(tMap[sType] || '选择灵兽', { fontSize: 14 * S, fill: '#5C3A1E', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, pY + 28 * S)
  const sz = 48 * S, gap = 10 * S, n = Math.min(g.pets.length, 5)
  const totW = n * sz + (n - 1) * gap, stX = (W - totW) / 2, rY = pY + 48 * S
  g._shopPetRects = []
  g.pets.forEach((p, i) => {
    const px = stX + i * (sz + gap), ac = ATTR_COLOR[p.attr]
    let can = true, dim = ''
    if (sType === 'starUp' && (p.star || 1) >= 3) { can = false; dim = '已满星' }
    if (sType === 'cdReduce' && p.cd <= 2) { can = false; dim = 'CD已最低' }
    const isSel = selIdx === i, a = can ? 1 : 0.4
    const bg = pool.gfx(); bg.beginFill(PR.colorToInt(ac ? ac.bg : '#1a1a2e'))
    bg.drawRect(px, rY, sz, sz); bg.endFill(); bg.alpha = a
    const av = pool.spr(getPetAvatarPath(p))
    av.position.set(px + 1, rY + 1); av.width = sz - 2; av.height = sz - 2; av.alpha = a
    const fs2 = sz * 1.12, fo = (fs2 - sz) / 2
    const fr = pool.spr(`assets/ui/frame_pet_${p.attr}.png`)
    fr.position.set(px - fo, rY - fo); fr.width = fs2; fr.height = fs2; fr.alpha = a
    if (isSel) { const s = pool.gfx(); s.lineStyle(3 * S, 0xffd700); s.drawRect(px - 2 * S, rY - 2 * S, sz + 4 * S, sz + 4 * S) }
    if ((p.star || 1) >= 1) { const st = pool.txt('★'.repeat(p.star || 1), { fontSize: sz * 0.14, fill: '#ffd700', fontWeight: 'bold', anchor: { x: 0, y: 1 }, stroke: '#000', strokeThickness: 2 * S })
      st.position.set(px + 2 * S, rY + sz - 2 * S); st.alpha = a }
    pool.txt(p.name.substring(0, 4), { fontSize: 8 * S, fill: can ? (ac ? ac.main : '#8B6914') : '#b4a082', fontWeight: 'bold', anchor: 0.5 }).position.set(px + sz / 2, rY + sz + 12 * S)
    let info = '', ic = '#c09830'
    if (sType === 'starUp') { info = can ? `★${p.star || 1}→★${(p.star || 1) + 1}` : dim; ic = can ? '#c09830' : '#b4a082' }
    else if (sType === 'upgradePet') { info = `ATK:${p.atk}→${Math.round(p.atk * 1.25)}`; ic = '#c07030' }
    else if (sType === 'cdReduce') { info = can ? `CD:${p.cd}→${p.cd - 1}` : dim; ic = can ? '#508090' : '#b4a082' }
    if (info) pool.txt(info, { fontSize: 7 * S, fill: ic, fontWeight: 'bold', anchor: 0.5 }).position.set(px + sz / 2, rY + sz + 22 * S)
    if (can) g._shopPetRects.push([px, rY, sz, sz, i])
  })
  let botY = rY + sz + 30 * S
  if (hasSel && g.pets[selIdx]) { const sp = g.pets[selIdx]
    const dBg = pool.gfx(); dBg.beginFill(0x5C3A1E, 0.12); dBg.drawRoundedRect(pX + 12 * S, botY, pW - 24 * S, 48 * S, 6 * S); dBg.endFill()
    let dt = sp.name
    if (sType === 'starUp') dt += `  ★${sp.star || 1} → ★${(sp.star || 1) + 1}`
    else if (sType === 'upgradePet') dt += `  ATK ${sp.atk} → ${Math.round(sp.atk * 1.25)}`
    else if (sType === 'cdReduce') dt += `  CD ${sp.cd} → ${sp.cd - 1}`
    pool.txt(dt, { fontSize: 11 * S, fill: '#5C3A1E', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, botY + 18 * S)
    const sd = sp.skillDesc || (sp.skill && sp.skill.desc) || ''
    pool.txt(String(sd).substring(0, 30), { fontSize: 9 * S, fill: '#5C3A1E80', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, botY + 35 * S)
    botY += 56 * S
  }
  const abY = botY + 4 * S
  if (hasSel) {
    const cW = 80 * S, cH = 32 * S, gap = 20 * S, tot = cW * 2 + gap, sx = (W - tot) / 2
    _drawButton(pool, sx, abY, cW, cH, '取消', '#a0896a', S); g._shopPetCancelRect = [sx, abY, cW, cH]
    _drawButton(pool, sx + cW + gap, abY, cW, cH, '确定', '#b08840', S); g._shopPetConfirmRect = [sx + cW + gap, abY, cW, cH]
  } else {
    const cW = 80 * S, cH = 32 * S
    _drawButton(pool, (W - cW) / 2, abY, cW, cH, '取消', '#a0896a', S)
    g._shopPetCancelRect = [(W - cW) / 2, abY, cW, cH]; g._shopPetConfirmRect = null
  }
}

// ===== 战斗预览（主体） =====
function _buildBattle(pool, g, ev, curY, padX, ATTR_COLOR, ATTR_NAME, COUNTER_BY, COUNTER_MAP, getRealmInfo, getPetStarAtk, getPetAvatarPath, wrapText, petHasSkill, getPetSkillDesc, MAX_STAR, PR, W, H, S, safeTop) {
  const e = ev.data, ac = ATTR_COLOR[e.attr]

  // 敌人信息卡
  const cX = padX, cW = W - padX * 2, cT = curY, cH = 90 * S
  const cBg = pool.gfx(); cBg.beginFill(0x0f0f1e, 0.75); cBg.drawRoundedRect(cX, cT, cW, cH, 10 * S); cBg.endFill()
  cBg.lineStyle(1, ac ? PR.colorToInt(ac.main) : 0xffffff, ac ? 0.4 : 0.15); cBg.drawRoundedRect(cX, cT, cW, cH, 10 * S)
  const avSz = 60 * S, avX = cX + 12 * S, avY = cT + (cH - avSz) / 2
  const avBg = pool.gfx(); avBg.beginFill(PR.colorToInt(ac ? ac.bg : '#1a1a2e')); avBg.drawRoundedRect(avX, avY, avSz, avSz, 6 * S); avBg.endFill()
  if (e.avatar) { const sp = pool.spr(`assets/${e.avatar}.png`); sp.position.set(avX + 1, avY + 1); sp.width = avSz - 2; sp.height = avSz - 2 }
  const avBd = pool.gfx(); avBd.lineStyle(1.5 * S, ac ? PR.colorToInt(ac.main) : 0x666666); avBd.drawRoundedRect(avX, avY, avSz, avSz, 6 * S)
  const iX = avX + avSz + 12 * S; let iY = cT + 24 * S
  pool.txt(e.name, { fontSize: 14 * S, fill: ac ? ac.main : '#e0d0b0', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(iX, iY)
  iY += 20 * S; pool.txt(`${ATTR_NAME[e.attr]}属性`, { fontSize: 11 * S, fill: ac ? ac.main : '#e0d0b0', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(iX, iY)
  iY += 22 * S; let bx = iX; const oR = 8 * S
  const wkA = COUNTER_BY[e.attr]
  if (wkA) { pool.txt('弱点:', { fontSize: 12 * S, fill: '#ddd', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(bx, iY); bx += 42 * S
    const wo = pool.bead(wkA, oR * 2); wo.position.set(bx + oR, iY); bx += oR * 2 + 14 * S }
  const rsA = COUNTER_MAP[e.attr]
  if (rsA) { pool.txt('抵抗:', { fontSize: 12 * S, fill: '#999', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(bx, iY); bx += 42 * S
    pool.bead(rsA, oR * 2).position.set(bx + oR, iY) }
  curY = cT + cH + 8 * S

  // 分界线
  const dv = pool.gfx(); dv.lineStyle(1.5 * S, 0xb4a078, 0.5); dv.moveTo(padX + W * 0.1, curY); dv.lineTo(W - padX - W * 0.1, curY)
  curY += 16 * S
  pool.txt('── 己方队伍 ──', { fontSize: 12 * S, fill: '#d0c0a0', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, curY)
  curY += 14 * S

  // HP条
  const hpH = 14 * S; const _realm = getRealmInfo(g.floor); const _rn = _realm ? _realm.name : ''
  if (_rn) {
    const rl = pool.txt(_rn, { fontSize: 9 * S, fill: '#e8d5b0', fontWeight: 'bold', anchor: { x: 0, y: 0.5 }, dropShadow: true, dropShadowColor: '#000', dropShadowBlur: 2 * S, dropShadowDistance: 0 })
    rl.position.set(padX, curY + hpH * 0.5)
    const rlW = _rn.length * 9 * S + 6 * S
    pool.hpBar(padX + rlW, curY, W - padX * 2 - rlW, hpH, g.heroHp, g.heroMaxHp, '#d4607a', true)
  } else { pool.hpBar(padX, curY, W - padX * 2, hpH, g.heroHp, g.heroMaxHp, '#d4607a', true) }
  curY += hpH + 10 * S

  // Buff文字
  if (g.runBuffLog && g.runBuffLog.length > 0) {
    const BL = { allAtkPct:'全队攻击', allDmgPct:'全属伤害', heartBoostPct:'心珠回复', weaponBoostPct:'法宝效果', extraTimeSec:'转珠时间', hpMaxPct:'血量上限', comboDmgPct:'Combo伤害', counterDmgPct:'克制伤害', skillDmgPct:'技能伤害', dmgReducePct:'受伤减少' }
    const merged = {}; for (const en2 of g.runBuffLog) { const k = en2.buff; if (!merged[k]) merged[k] = { buff: k, val: 0 }; merged[k].val += en2.val }
    const bi = Object.values(merged); if (bi.length > 0) {
      const str = bi.map(it => `${BL[it.buff] || it.buff}${it.val > 0 ? '+' : ''}${it.buff === 'extraTimeSec' ? it.val.toFixed(1) + 's' : it.val + '%'}`).join('  ')
      const bl = pool.txt(str, { fontSize: 8 * S, fill: '#88ff99', fontWeight: 'bold', anchor: 0.5, wordWrap: true, wordWrapWidth: W - padX * 2 })
      bl.position.set(W * 0.5, curY + 8 * S); curY += 20 * S
    }
  }

  // 队伍栏
  const drag = g._eventDragPet, tSlots = 6, tSP = 8 * S, tPG = 8 * S, tWG = 12 * S
  const tGW = tWG + tPG * 4 + tSP * 2, tIS = (W - tGW) / tSlots, tBH = tIS + 6 * S, tBY = curY, tIY = tBY + (tBH - tIS) / 2
  const fSc = 1.12, fSz = tIS * fSc, fOf = (fSz - tIS) / 2
  const tBg = pool.gfx(); tBg.beginFill(0x080814, 0.88); tBg.drawRoundedRect(0, tBY, W, tBH, 6 * S); tBg.endFill()
  for (let i = 0; i < tSlots; i++) {
    let ix = i === 0 ? tSP : tSP + tIS + tWG + (i - 1) * (tIS + tPG)
    if (i === 0) { _buildWpnSlot(pool, g, ix, tIY, tIS, PR, S) }
    else { _buildPetSlot(pool, g, i - 1, ix, tIY, tIS, fSz, fOf, e, drag, ATTR_COLOR, COUNTER_BY, getPetAvatarPath, PR, S) }
  }
  curY = tBY + tBH + 8 * S

  // 分界线2
  const dv2 = pool.gfx(); dv2.lineStyle(S, 0xb4a078, 0.35); dv2.moveTo(padX + W * 0.1, curY); dv2.lineTo(W - padX - W * 0.1, curY); curY += 8 * S

  // 法宝背包
  pool.txt('── 法宝背包 ──', { fontSize: 12 * S, fill: '#d0c0a0', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, curY); curY += 14 * S
  pool.txt('拖动到上方可替换装备', { fontSize: 9 * S, fill: '#c8b48c80', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, curY); curY += 10 * S
  const bC = 6, bG = tPG, bSS = tIS
  if (g.weaponBag.length > 0) {
    for (let i = 0; i < g.weaponBag.length; i++) { const c = i % bC, r = Math.floor(i / bC)
      const bx2 = tSP + c * (bSS + bG), by2 = curY + r * (bSS + bG), wp = g.weaponBag[i]
      const isDrg = g._eventDragWpn && g._eventDragWpn.source === 'bag' && g._eventDragWpn.index === i, a = isDrg ? 0.3 : 1
      const wBg = pool.gfx(); wBg.beginFill(0x0f0f1e, 0.6); wBg.drawRect(bx2 + 1, by2 + 1, bSS - 2, bSS - 2); wBg.endFill(); wBg.alpha = a
      const wSp = pool.spr(`assets/equipment/fabao_${wp.id}.png`); wSp.position.set(bx2 + 1, by2 + 1); wSp.width = bSS - 2; wSp.height = bSS - 2; wSp.alpha = a
      const wFr = pool.gfx(); wFr.lineStyle(2 * S, 0xffd700, 0.7); wFr.drawRoundedRect(bx2 - 1, by2 - 1, bSS + 2, bSS + 2, 3 * S); wFr.alpha = a
      if (g._lastRewardInfo && g._lastRewardInfo.type === 'newWeapon' && wp.id === g._lastRewardInfo.weaponId) _drawBadge(pool, bx2, by2, bSS, 'NEW', '#e04040', PR, S)
      g._eventWpnSlots.push({ rect: [bx2, by2, bSS, bSS], action: 'equip', type: 'bag', index: i })
    }
    curY += Math.ceil(g.weaponBag.length / bC) * (bSS + bG) + 6 * S
  } else { pool.txt('空', { fontSize: 11 * S, fill: '#c8b48c66', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, curY + bSS * 0.4); curY += bSS * 0.8 + 6 * S }

  // 灵宠背包
  pool.txt('── 灵宠背包 ──', { fontSize: 12 * S, fill: '#d0c0a0', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, curY); curY += 14 * S
  pool.txt('拖动到上方队伍可交换', { fontSize: 9 * S, fill: '#c8b48c80', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, curY); curY += 10 * S
  if (g.petBag.length > 0) {
    for (let i = 0; i < g.petBag.length; i++) { const c = i % bC, r = Math.floor(i / bC)
      const bx2 = tSP + c * (bSS + bG), by2 = curY + r * (bSS + bG)
      g._eventPetSlots.push({ rect: [bx2, by2, bSS, bSS], type: 'bag', index: i })
      g._eventBagPetRects.push([bx2, by2, bSS, bSS])
      const isDrg = drag && drag.source === 'bag' && drag.index === i, a = isDrg ? 0.3 : 1
      const bp = g.petBag[i], bpAc = ATTR_COLOR[bp.attr]
      const pBg = pool.gfx(); pBg.beginFill(PR.colorToInt(bpAc ? bpAc.bg : '#1a1a2e')); pBg.drawRect(bx2, by2, bSS, bSS); pBg.endFill(); pBg.alpha = a
      const pAv = pool.spr(getPetAvatarPath(bp)); pAv.position.set(bx2 + 1, by2 + 1); pAv.width = bSS - 2; pAv.height = bSS - 2; pAv.alpha = a
      const pFr = pool.spr(`assets/ui/frame_pet_${bp.attr}.png`); pFr.position.set(bx2 - fOf, by2 - fOf); pFr.width = fSz; pFr.height = fSz; pFr.alpha = a
      if ((bp.star || 1) >= 1) { const st = pool.txt('★'.repeat(bp.star || 1), { fontSize: bSS * 0.14, fill: '#ffd700', fontWeight: 'bold', anchor: { x: 0, y: 1 }, stroke: '#000', strokeThickness: 2 * S })
        st.position.set(bx2 + 2 * S, by2 + bSS - 2 * S); st.alpha = a }
      const bri = g._lastRewardInfo
      if (bri && bri.petId === bp.id) { if (bri.type === 'newPet') _drawBadge(pool, bx2, by2, bSS, 'NEW', '#e04040', PR, S)
        else if (bri.type === 'starUp') _drawBadge(pool, bx2, by2, bSS, 'UP', '#30b050', PR, S) }
      const bWk = COUNTER_BY[e.attr]
      if (bWk && bp.attr === bWk) { const hl = pool.gfx(); hl.lineStyle(2.5 * S, ATTR_COLOR[bWk] ? PR.colorToInt(ATTR_COLOR[bWk].main) : 0x4dff4d)
        hl.drawRect(bx2 - 1, by2 - 1, bSS + 2, bSS + 2); hl.alpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((g.af || 0) * 0.08)) }
      if (drag && drag.source === 'team' && g._hitRect && g._hitRect(drag.x, drag.y, bx2, by2, bSS, bSS)) {
        const hl = pool.gfx(); hl.lineStyle(2.5 * S, 0xffd700); hl.drawRect(bx2 - 1, by2 - 1, bSS + 2, bSS + 2) }
    }
    curY += Math.ceil(g.petBag.length / bC) * (bSS + bG)
  } else { pool.txt('空', { fontSize: 11 * S, fill: '#c8b48c66', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, curY + bSS * 0.4); curY += bSS * 0.8 }
  curY += 8 * S

  // 新手提示
  if (g._tutorialJustDone && g.floor === 1) { const hW = W * 0.88, hX = (W - hW) / 2, hY = curY
    const hBg = pool.gfx(); hBg.beginFill(0x141e32, 0.85); hBg.drawRoundedRect(hX, hY, hW, 56 * S, 8 * S); hBg.endFill()
    hBg.lineStyle(1, 0x64b4ff, 0.4); hBg.drawRoundedRect(hX, hY, hW, 56 * S, 8 * S)
    pool.txt('💡 冒险开始', { fontSize: 11 * S, fill: '#80d0ff', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, hY + 14 * S)
    pool.txt('正式冒险初始携带4只灵兽和1件基础法宝', { fontSize: 9.5 * S, fill: '#b0c8e0', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, hY + 30 * S)
    pool.txt('击败怪物可获得新灵兽或法宝，通关30层即为胜利！', { fontSize: 9.5 * S, fill: '#b0c8e0', fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, hY + 44 * S)
    curY += 64 * S }

  // 进入战斗按钮
  const gBW = W * 0.6, gBH = gBW / 4, gBX = (W - gBW) / 2, gBY = H - gBH - 28 * S
  const btnSp = pool.spr('assets/ui/btn_start.png'); btnSp.position.set(gBX, gBY); btnSp.width = gBW; btnSp.height = gBH
  pool.txt('进入战斗', { fontSize: 16 * S, fill: '#fff', fontWeight: 'bold', anchor: 0.5, dropShadow: true, dropShadowColor: '#000', dropShadowBlur: 4 * S, dropShadowDistance: 0 }).position.set(W * 0.5, gBY + gBH * 0.5)
  g._eventBtnRect = [gBX, gBY, gBW, gBH]

  // 返回
  const bbW = 60 * S, bbH = 30 * S, bbX = 8 * S, bbY = safeTop + 6 * S
  const bbBg = pool.gfx(); bbBg.beginFill(0x3c2814, 0.6); bbBg.drawRoundedRect(bbX, bbY, bbW, bbH, 6 * S); bbBg.endFill()
  bbBg.lineStyle(1, 0xc8aa78, 0.4); bbBg.drawRoundedRect(bbX, bbY, bbW, bbH, 6 * S)
  pool.txt('< 首页', { fontSize: 13 * S, fill: '#f0e0c0', fontWeight: 'bold', anchor: 0.5 }).position.set(bbX + bbW * 0.5, bbY + bbH * 0.5)
  g._backBtnRect = [bbX, bbY, bbW, bbH]

  // 拖拽灵宠
  if (drag && drag.pet) { const dSz = tIS * 0.9
    const dBg = pool.gfx(); dBg.beginFill(PR.colorToInt(ATTR_COLOR[drag.pet.attr] ? ATTR_COLOR[drag.pet.attr].bg : '#1a1a2e'))
    dBg.drawRect(drag.x - dSz / 2, drag.y - dSz / 2, dSz, dSz); dBg.endFill(); dBg.alpha = 0.85
    const dAv = pool.spr(getPetAvatarPath(drag.pet)); dAv.position.set(drag.x - dSz / 2, drag.y - dSz / 2); dAv.width = dSz; dAv.height = dSz; dAv.alpha = 0.85
    const dFr = pool.spr(`assets/ui/frame_pet_${drag.pet.attr}.png`); const dfs = dSz * fSc, dfo = (dfs - dSz) / 2
    dFr.position.set(drag.x - dSz / 2 - dfo, drag.y - dSz / 2 - dfo); dFr.width = dfs; dFr.height = dfs; dFr.alpha = 0.85 }

  // 拖拽法宝
  const wDrg = g._eventDragWpn
  if (wDrg && wDrg.weapon) { const dSz = tIS * 0.9
    const dBg = pool.gfx(); dBg.beginFill(0x1a1510); dBg.drawRect(wDrg.x - dSz / 2, wDrg.y - dSz / 2, dSz, dSz); dBg.endFill(); dBg.alpha = 0.85
    const dSp = pool.spr(`assets/equipment/fabao_${wDrg.weapon.id}.png`); dSp.position.set(wDrg.x - dSz / 2, wDrg.y - dSz / 2); dSp.width = dSz; dSp.height = dSz; dSp.alpha = 0.85
    const dFr = pool.gfx(); dFr.lineStyle(2 * S, 0xffd700, 0.7); dFr.drawRoundedRect(wDrg.x - dSz / 2 - 1, wDrg.y - dSz / 2 - 1, dSz + 2, dSz + 2, 3 * S); dFr.alpha = 0.85 }

  // 弹窗
  if (g._eventPetDetail != null) _buildPetDetail(pool, g, getPetStarAtk, getPetAvatarPath, petHasSkill, getPetSkillDesc, MAX_STAR, ATTR_COLOR, wrapText, PR, W, H, S)
  if (g._eventWpnDetail != null) _buildWpnDetail(pool, g, wrapText, PR, W, H, S)
  if (g._shopPetObtained) _buildPetObtained(pool, g, g._shopPetObtained, getPetStarAtk, getPetAvatarPath, petHasSkill, getPetSkillDesc, MAX_STAR, ATTR_COLOR, PR, W, H, S)
}

function _buildWpnSlot(pool, g, ix, iy, sz, PR, S) {
  const isDrg = g._eventDragWpn && g._eventDragWpn.source === 'equipped', a = isDrg ? 0.3 : 1
  if (g.weapon) {
    const bg = pool.gfx(); bg.beginFill(0x1a1510); bg.drawRect(ix + 1, iy + 1, sz - 2, sz - 2); bg.endFill(); bg.alpha = a
    const sp = pool.spr(`assets/equipment/fabao_${g.weapon.id}.png`); sp.position.set(ix + 1, iy + 1); sp.width = sz - 2; sp.height = sz - 2; sp.alpha = a
  } else {
    const bg = pool.gfx(); bg.beginFill(0x191612, 0.8); bg.drawRect(ix + 1, iy + 1, sz - 2, sz - 2); bg.endFill()
    pool.txt('⚔', { fontSize: sz * 0.26, fill: '#504640', anchor: 0.5 }).position.set(ix + sz * 0.5, iy + sz * 0.5)
  }
  const fr = pool.gfx(); fr.lineStyle(2 * S, 0xffd700, 0.7); fr.drawRoundedRect(ix - 1, iy - 1, sz + 2, sz + 2, 3 * S); fr.alpha = a
  if (g._lastRewardInfo && g._lastRewardInfo.type === 'newWeapon' && g.weapon && g.weapon.id === g._lastRewardInfo.weaponId)
    _drawBadge(pool, ix, iy, sz, 'NEW', '#e04040', PR, S)
  g._eventWpnSlots.push({ rect: [ix, iy, sz, sz], action: 'detail', type: 'equipped', index: 0 })
}

function _buildPetSlot(pool, g, petIdx, ix, iy, sz, fSz, fOf, e, drag, ATTR_COLOR, COUNTER_BY, getPetAvatarPath, PR, S) {
  if (petIdx < g.pets.length) {
    const p = g.pets[petIdx], ac = ATTR_COLOR[p.attr]
    const bg = pool.gfx(); bg.beginFill(PR.colorToInt(ac ? ac.bg : '#1a1a2e')); bg.drawRect(ix + 1, iy + 1, sz - 2, sz - 2); bg.endFill()
    const av = pool.spr(getPetAvatarPath(p)); av.position.set(ix + 1, iy + 1); av.width = sz - 2; av.height = sz - 2
    const fr = pool.spr(`assets/ui/frame_pet_${p.attr}.png`); fr.position.set(ix - fOf, iy - fOf); fr.width = fSz; fr.height = fSz
    if ((p.star || 1) >= 1) { const st = pool.txt('★'.repeat(p.star || 1), { fontSize: sz * 0.14, fill: '#ffd700', fontWeight: 'bold', anchor: { x: 0, y: 1 }, stroke: '#000', strokeThickness: 2 * S })
      st.position.set(ix + 2 * S, iy + sz - 2 * S) }
    const ri = g._lastRewardInfo
    if (ri && ri.petId === p.id) { if (ri.type === 'newPet') _drawBadge(pool, ix, iy, sz, 'NEW', '#e04040', PR, S)
      else if (ri.type === 'starUp') _drawBadge(pool, ix, iy, sz, 'UP', '#30b050', PR, S) }
    const wk = COUNTER_BY[e.attr]
    if (wk && p.attr === wk) { const hl = pool.gfx(); hl.lineStyle(2.5 * S, ATTR_COLOR[wk] ? PR.colorToInt(ATTR_COLOR[wk].main) : 0x4dff4d)
      hl.drawRect(ix - 1, iy - 1, sz + 2, sz + 2); hl.alpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((g.af || 0) * 0.08)) }
  } else {
    const bg = pool.gfx(); bg.beginFill(0x12121e, 0.6); bg.drawRect(ix + 1, iy + 1, sz - 2, sz - 2); bg.endFill()
    const fr = pool.spr('assets/ui/frame_pet_metal.png'); fr.position.set(ix - fOf, iy - fOf); fr.width = fSz; fr.height = fSz; fr.alpha = 0.35
  }
  g._eventPetSlots.push({ rect: [ix, iy, sz, sz], type: 'team', index: petIdx })
  g._eventPetRects.push([ix, iy, sz, sz])
  if (drag && drag.source === 'bag' && g._hitRect && g._hitRect(drag.x, drag.y, ix, iy, sz, sz)) {
    const hl = pool.gfx(); hl.lineStyle(2.5 * S, 0xffd700); hl.drawRect(ix - 1, iy - 1, sz + 2, sz + 2) }
}

function _buildPetDetail(pool, g, getPetStarAtk, getPetAvatarPath, petHasSkill, getPetSkillDesc, MAX_STAR, ATTR_COLOR, wrapText, PR, W, H, S) {
  const idx = g._eventPetDetail; if (idx == null) return
  const p = g._eventPetDetailData || (idx >= 0 && idx < g.pets.length ? g.pets[idx] : null); if (!p) return
  const ac = ATTR_COLOR[p.attr], cStar = p.star || 1, isMax = cStar >= MAX_STAR, cAtk = getPetStarAtk(p)
  const sd = petHasSkill(p) ? (getPetSkillDesc(p) || (p.skill ? p.skill.desc : '')) : ''
  const ov = pool.gfx(); ov.beginFill(0x000000, 0.45); ov.drawRect(0, 0, W, H); ov.endFill()
  const cW = W * 0.82, pH = 16 * S, lH = 14 * S, avS = 36 * S
  let cH = pH * 2 + Math.max(avS, 32 * S) + 6 * S + lH + (sd ? Math.ceil(sd.length / 18) * lH : 0) + (isMax ? 0 : 80 * S)
  cH = Math.max(cH, 120 * S)
  const cX = (W - cW) / 2, cY = (H - cH) / 2
  _drawInfoPanel(pool, cX, cY, cW, cH, S)
  let iy = cY + pH; const lx = cX + pH
  const avBg = pool.gfx(); avBg.beginFill(PR.colorToInt(ac ? ac.bg : '#E8E0D8')); avBg.drawRoundedRect(lx, iy, avS, avS, 6 * S); avBg.endFill()
  const av = pool.spr(getPetAvatarPath(p)); av.position.set(lx + 1, iy + 1); av.width = avS - 2; av.height = avS - 2
  const txL = lx + avS + 12 * S, starStr = '★'.repeat(cStar) + (cStar < MAX_STAR ? '☆'.repeat(MAX_STAR - cStar) : '')
  pool.txt(`${p.name} ${starStr}`, { fontSize: 13 * S, fill: '#3D2B1F', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(txL, iy + 14 * S)
  pool.txt(`ATK：${cAtk}`, { fontSize: 10 * S, fill: '#c06020', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(txL, iy + 30 * S)
  iy = Math.max(iy + 36 * S, iy + avS) + 6 * S + lH
  if (petHasSkill(p)) {
    pool.txt(`技能：${p.skill.name}  CD ${p.cd}`, { fontSize: 11 * S, fill: '#7A5C30', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(lx, iy)
    if (sd) { iy += lH; pool.txt(sd, { fontSize: 10 * S, fill: '#4A3B30', anchor: { x: 0, y: 0 }, wordWrap: true, wordWrapWidth: cW - pH * 2 - 4 * S }).position.set(lx + 4 * S, iy) }
  } else { pool.txt('技能：升至★2解锁', { fontSize: 11 * S, fill: '#8B7B70', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(lx, iy) }
  if (!isMax) { iy += 10 * S; const dv = pool.gfx(); dv.lineStyle(S, 0xa08c64, 0.3); dv.moveTo(lx, iy); dv.lineTo(cX + cW - pH, iy); iy += 12 * S
    pool.txt(`下一级 ${'★'.repeat(cStar + 1)}`, { fontSize: 11 * S, fill: '#8B6E4E', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(lx, iy + lH * 0.5); iy += lH
    const nP = { ...p, star: cStar + 1 }, nA = getPetStarAtk(nP)
    pool.txt(`ATK：${nA}`, { fontSize: 11 * S, fill: nA !== cAtk ? '#c06020' : '#4A3B30', fontWeight: nA !== cAtk ? 'bold' : 'normal', anchor: { x: 0, y: 0.5 } }).position.set(lx, iy + lH * 0.5); iy += lH
    if (petHasSkill(nP)) { const pf = !petHasSkill(p) ? '解锁技能：' : '技能：', sc = !petHasSkill(p) ? '#c06020' : '#6B5B50'
      pool.txt(`${pf}${p.skill ? p.skill.name : '无'}  CD ${p.cd}`, { fontSize: 11 * S, fill: sc, fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(lx, iy + lH * 0.5); iy += lH
      const nsd = getPetSkillDesc(nP) || ''; if (nsd) { pool.txt(nsd, { fontSize: 10 * S, fill: nsd !== sd ? '#c06020' : '#4A3B30', anchor: { x: 0, y: 0 }, wordWrap: true, wordWrapWidth: cW - pH * 2 - 4 * S }).position.set(lx + 4 * S, iy) } } }
  g._eventPetDetailCloseRect = [0, 0, W, H]
}

function _buildWpnDetail(pool, g, wrapText, PR, W, H, S) {
  const wp = g._eventWpnDetailData; if (!wp) return
  const ov = pool.gfx(); ov.beginFill(0x000000, 0.45); ov.drawRect(0, 0, W, H); ov.endFill()
  const cW = W * 0.76, pH = 16 * S, iSz = 42 * S, cH = Math.max(90 * S, pH * 2 + 80 * S)
  const cX = (W - cW) / 2, cY = (H - cH) / 2
  _drawInfoPanel(pool, cX, cY, cW, cH, S)
  const iX = cX + pH, iY = cY + pH
  const iBg = pool.gfx(); iBg.beginFill(0xE8E0D8); iBg.drawRoundedRect(iX, iY, iSz, iSz, 6 * S); iBg.endFill()
  const wSp = pool.spr(`assets/equipment/fabao_${wp.id}.png`); wSp.position.set(iX, iY); wSp.width = iSz; wSp.height = iSz
  const tX = iX + iSz + 10 * S
  pool.txt('法宝·', { fontSize: 13 * S, fill: '#e0a020', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(tX, cY + pH + 14 * S)
  pool.txt(wp.name, { fontSize: 13 * S, fill: '#8B6914', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(tX + 42 * S, cY + pH + 14 * S)
  pool.txt(wp.desc, { fontSize: 10 * S, fill: '#4A3B30', anchor: { x: 0, y: 0 }, wordWrap: true, wordWrapWidth: cW - iSz - pH * 2 - 10 * S }).position.set(tX, cY + pH + 28 * S)
  g._eventWpnDetailCloseRect = [0, 0, W, H]
}

function _buildPetObtained(pool, g, info, getPetStarAtk, getPetAvatarPath, petHasSkill, getPetSkillDesc, MAX_STAR, ATTR_COLOR, PR, W, H, S) {
  if (!info || !info.pet) return
  const p = info.pet, ac = ATTR_COLOR[p.attr], cStar = p.star || 1, cAtk = getPetStarAtk(p)
  const sd = petHasSkill(p) ? (getPetSkillDesc(p) || (p.skill ? p.skill.desc : '')) : ''
  const lH = 14 * S, avS = 48 * S
  const ov = pool.gfx(); ov.beginFill(0x000000, 0.45); ov.drawRect(0, 0, W, H); ov.endFill()
  let tH = 28 * S + 20 * S + 10 * S + Math.max(avS, lH * 2) + 6 * S + lH + (sd ? Math.ceil(sd.length / 18) * lH : 0) + 20 * S
  tH = Math.max(tH, 140 * S)
  const cW = W * 0.78, cX = (W - cW) / 2, cY = (H - tH) / 2, pH = 14 * S
  _drawInfoPanel(pool, cX, cY, cW, tH, S)
  let iy = cY + pH; const lx = cX + 16 * S
  let tt = '获得新灵兽！', tc = '#8B6914'
  if (info.type === 'starUp') { tt = '灵兽升星！'; tc = '#c06020' }
  else if (info.type === 'maxed') { tt = '灵兽已满星'; tc = '#8B7B70' }
  pool.txt(tt, { fontSize: 14 * S, fill: tc, fontWeight: 'bold', anchor: 0.5 }).position.set(W * 0.5, iy + 12 * S); iy += 30 * S
  const avBg = pool.gfx(); avBg.beginFill(PR.colorToInt(ac ? ac.bg : '#E8E0D8')); avBg.drawRoundedRect(lx, iy, avS, avS, 6 * S); avBg.endFill()
  const av = pool.spr(getPetAvatarPath(p)); av.position.set(lx + 1, iy + 1); av.width = avS - 2; av.height = avS - 2
  const txL = lx + avS + 10 * S, starStr = '★'.repeat(cStar) + (cStar < MAX_STAR ? '☆'.repeat(MAX_STAR - cStar) : '')
  pool.txt(`${p.name} ${starStr}`, { fontSize: 13 * S, fill: '#3D2B1F', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(txL, iy + lH)
  pool.txt(`ATK：${cAtk}`, { fontSize: 10 * S, fill: '#c06020', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(txL, iy + lH * 2)
  iy = Math.max(iy + lH * 2 + 4 * S, iy + avS) + 6 * S + lH
  if (petHasSkill(p)) {
    pool.txt(`技能：${p.skill.name}  CD ${p.cd}`, { fontSize: 11 * S, fill: '#7A5C30', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(lx, iy)
    if (sd) { iy += lH; pool.txt(sd, { fontSize: 10 * S, fill: '#4A3B30', anchor: { x: 0, y: 0 }, wordWrap: true, wordWrapWidth: cW - 32 * S - 4 * S }).position.set(lx + 4 * S, iy) }
  } else { pool.txt('技能：升至★2解锁', { fontSize: 11 * S, fill: '#8B7B70', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } }).position.set(lx, iy) }
  pool.txt('点击任意位置关闭', { fontSize: 9 * S, fill: '#9B8B80', anchor: 0.5 }).position.set(W * 0.5, cY + tH + 14 * S)
  g._eventPetDetailCloseRect = [0, 0, W, H]
}

module.exports = { createEventBuilder }
