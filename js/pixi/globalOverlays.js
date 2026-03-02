/**
 * 全局覆盖层：宠物获得弹窗、★3满星庆祝
 * 渲染到 SceneManager.overlayContainer（zIndex=900）
 * 
 * 性能优化：
 * - 宠物获得弹窗：纯静态，只构建一次直到关闭
 * - ★3庆祝：用 FramePool 对象池复用
 */
const PIXI = require('../libs/pixi-wrapper')
const { FramePool } = require('./ObjectPool')

function createOverlayRenderer(deps) {
  const { SceneManager, PR, W, H, S } = deps

  // 缓存状态
  let _lastPopupKey = ''
  let _staticLayer = null    // 宠物获得弹窗（静态，只构建一次）
  let _celebPool = null       // ★3庆祝用的对象池
  let _celebLayer = null      // ★3庆祝容器

  // ===== 简易中文断行 =====
  function _wrapText(text, maxW, fontSize) {
    if (!text) return ['']
    const fullW = fontSize * S, halfW = fontSize * S * 0.55
    const result = []; let line = '', lineW = 0
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], cw = ch.charCodeAt(0) > 127 ? fullW : halfW
      if (lineW + cw > maxW && line.length > 0) { result.push(line); line = ch; lineW = cw }
      else { line += ch; lineW += cw }
    }
    if (line) result.push(line)
    return result.length ? result : ['']
  }

  // ===== 高亮数字的文本（数字橙色加粗） =====
  function _addHighlightLine(container, text, x, y, fontSize) {
    const numRe = /(\d+[\d.]*%?倍?)/g
    let cx = x, lastIdx = 0, match
    numRe.lastIndex = 0
    while ((match = numRe.exec(text)) !== null) {
      if (match.index > lastIdx) {
        const before = text.substring(lastIdx, match.index)
        const t = PR.createText(before, { fontSize: fontSize * S, fill: '#4A3B30', anchor: { x: 0, y: 0.5 } })
        t.position.set(cx, y); container.addChild(t); cx += t.width
      }
      const ht = PR.createText(match[0], { fontSize: fontSize * S, fill: '#c06020', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
      ht.position.set(cx, y); container.addChild(ht); cx += ht.width
      lastIdx = match.index + match[0].length
    }
    if (lastIdx < text.length) {
      const t = PR.createText(text.substring(lastIdx), { fontSize: fontSize * S, fill: '#4A3B30', anchor: { x: 0, y: 0.5 } })
      t.position.set(cx, y); container.addChild(t)
    }
    if (lastIdx === 0 && text.length > 0) {
      const t = PR.createText(text, { fontSize: fontSize * S, fill: '#4A3B30', anchor: { x: 0, y: 0.5 } })
      t.position.set(x, y); container.addChild(t)
    }
  }

  // =========================================================
  //  宠物获得弹窗 —— 纯静态，只构建一次
  // =========================================================
  function _buildPetObtainedPopup(overlay, g) {
    const info = g._petObtainedPopup
    if (!info || !info.pet) return
    const { ATTR_COLOR } = require('../data/tower')
    const { getPetStarAtk, getPetAvatarPath, MAX_STAR, getPetSkillDesc, petHasSkill } = require('../data/pets')

    const layer = new PIXI.Container()
    layer.name = 'petObtained'

    const p = info.pet
    const ac = ATTR_COLOR[p.attr]
    const curStar = p.star || 1
    const curAtk = getPetStarAtk(p)
    const skillDesc = petHasSkill(p) ? (getPetSkillDesc(p) || (p.skill ? p.skill.desc : '')) : ''

    const cardW = W * 0.78
    const padX = 16 * S, padY = 14 * S
    const maxTextW = cardW - padX * 2
    const lineH = 14 * S
    const avSz = 48 * S, avPad = 10 * S
    const descLines = skillDesc ? _wrapText(skillDesc, maxTextW - 4 * S, 9) : []

    const headerTextH = lineH * 2
    const headerH = Math.max(avSz, headerTextH) + 4 * S
    let totalH = padY * 2
    totalH += 20 * S + 10 * S + headerH + 6 * S + lineH + descLines.length * lineH + 20 * S
    totalH = Math.max(totalH, 140 * S)

    const cardX = (W - cardW) / 2
    const cardY = (H - totalH) / 2

    // 半透明遮罩
    const mask = new PIXI.Graphics()
    mask.beginFill(0x000000, 0.45); mask.drawRect(0, 0, W, H); mask.endFill()
    layer.addChild(mask)

    // 信息面板
    const panel = PR.createInfoPanel(cardX, cardY, cardW, totalH)
    layer.addChild(panel)

    let iy = cardY + padY
    const lx = cardX + padX

    // 标题
    let titleText = '获得新灵兽！', titleColor = '#8B6914'
    if (info.type === 'starUp') { titleText = '灵兽升星！'; titleColor = '#c06020' }
    else if (info.type === 'maxed') { titleText = '灵兽已满星'; titleColor = '#8B7B70' }
    const title = PR.createText(titleText, { fontSize: 14 * S, fill: titleColor, fontWeight: 'bold', anchor: 0.5 })
    title.position.set(W * 0.5, iy + 12 * S)
    layer.addChild(title)
    iy += 20 * S + 10 * S

    // 头像背景
    const avX = lx, avY = iy
    const avBg = new PIXI.Graphics()
    avBg.beginFill(PR.colorToInt(ac ? ac.bg : '#E8E0D8'))
    avBg.drawRoundedRect(avX, avY, avSz, avSz, 6 * S)
    avBg.endFill()
    layer.addChild(avBg)

    // 头像图片
    const petSprite = PR.createSprite(getPetAvatarPath(p))
    petSprite.position.set(avX + 1, avY + 1)
    petSprite.width = avSz - 2; petSprite.height = avSz - 2
    layer.addChild(petSprite)

    // 名称 + 星级
    const txL = avX + avSz + avPad
    iy += lineH
    const nameT = PR.createText(p.name, { fontSize: 13 * S, fill: '#3D2B1F', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
    nameT.position.set(txL, iy)
    layer.addChild(nameT)
    const starStr = '★'.repeat(curStar) + (curStar < MAX_STAR ? '☆'.repeat(MAX_STAR - curStar) : '')
    const starT = PR.createText(starStr, { fontSize: 10 * S, fill: '#C89510', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
    starT.position.set(txL + nameT.width + 6 * S, iy)
    layer.addChild(starT)

    // 属性珠 + ATK
    iy += lineH
    const orb = PR.createBeadSprite(p.attr, 5 * S)
    orb.position.set(txL + 5 * S, iy - 3 * S)
    layer.addChild(orb)
    const atkT = PR.createText(` ATK：`, { fontSize: 10 * S, fill: '#6B5B50', anchor: { x: 0, y: 0.5 } })
    atkT.position.set(txL + 10 * S + 4 * S, iy)
    layer.addChild(atkT)
    const atkV = PR.createText(String(curAtk), { fontSize: 10 * S, fill: '#c06020', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
    atkV.position.set(txL + 10 * S + 4 * S + atkT.width, iy)
    layer.addChild(atkV)

    iy = Math.max(iy, avY + avSz)
    iy += 6 * S

    // 技能区域
    iy += lineH
    if (petHasSkill(p)) {
      const skillTitle = `技能：${p.skill.name}`
      const stT = PR.createText(skillTitle, { fontSize: 11 * S, fill: '#7A5C30', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
      stT.position.set(lx, iy); layer.addChild(stT)
      const cdT = PR.createText(`CD ${p.cd}`, { fontSize: 11 * S, fill: '#c06020', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
      cdT.position.set(lx + stT.width + 6 * S, iy); layer.addChild(cdT)
      descLines.forEach(line => {
        iy += lineH
        _addHighlightLine(layer, line, lx + 4 * S, iy, 10)
      })
    } else {
      const noSkill = PR.createText('技能：升至★2解锁', { fontSize: 11 * S, fill: '#8B7B70', fontWeight: 'bold', anchor: { x: 0, y: 0.5 } })
      noSkill.position.set(lx, iy); layer.addChild(noSkill)
    }

    // 底部提示
    const hint = PR.createText('点击任意位置关闭', { fontSize: 9 * S, fill: '#9B8B80', anchor: 0.5 })
    hint.position.set(W * 0.5, cardY + totalH + 14 * S)
    layer.addChild(hint)

    overlay.addChild(layer)
    return layer
  }

  // =========================================================
  //  ★3满星庆祝 —— 用 FramePool 对象池
  // =========================================================
  function renderStar3Celebration(g) {
    const overlay = SceneManager.overlayContainer; if (!overlay) return
    const c = g._star3Celebration
    if (!c) return
    c.timer++
    const t = c.timer, pet = c.pet
    const { ATTR_COLOR, ATTR_NAME } = require('../data/tower')
    const { getPetAvatarPath, getStar3Override } = require('../data/pets')

    // 初始化庆祝专用容器和对象池
    if (!_celebLayer) {
      _celebLayer = new PIXI.Container()
      _celebLayer.name = 'star3celeb'
      overlay.addChild(_celebLayer)
      _celebPool = new FramePool(_celebLayer, { PR, AssetManager: require('./AssetManager'), S })
    }
    _celebPool.reset()

    if (t <= 20) c.phase = 'fadeIn'
    else if (t <= 40) c.phase = 'show'
    else c.phase = 'ready'

    // 遮罩
    const maskAlpha = t <= 20 ? t / 20 * 0.85 : 0.85
    const mg = _celebPool.gfx()
    mg.beginFill(0x05050f, maskAlpha); mg.drawRect(0, 0, W, H); mg.endFill()

    if (t < 5) { _celebPool.hideUnused(); return }  // 前5帧只显示遮罩

    const cx = W * 0.5, cy = H * 0.38
    const ac = ATTR_COLOR[pet.attr]
    const mainColor = ac ? ac.main : '#ffd700'
    const mainColorInt = PR.colorToInt(mainColor)

    // --- 粒子系统 ---
    if (!c._pixiParticles) c._pixiParticles = []
    if (t >= 22 && t <= 50 && t % 2 === 0) {
      for (let i = 0; i < 6; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 1.5 + Math.random() * 3
        c._pixiParticles.push({
          x: cx, y: cy,
          vx: Math.cos(angle) * speed * S,
          vy: Math.sin(angle) * speed * S - 1.5 * S,
          life: 40 + Math.random() * 30, t: 0,
          size: (2 + Math.random() * 3) * S,
          gold: Math.random() > 0.5,
        })
      }
    }
    c._pixiParticles = c._pixiParticles.filter(p => {
      p.t++; p.x += p.vx; p.y += p.vy; p.vy += 0.06 * S; p.vx *= 0.98
      return p.t < p.life
    })
    if (c._pixiParticles.length > 0) {
      const pg = _celebPool.gfx()
      c._pixiParticles.forEach(p => {
        const alpha = Math.max(0, 1 - p.t / p.life)
        const r = p.size * (1 - p.t / p.life * 0.5)
        pg.beginFill(p.gold ? 0xffd700 : mainColorInt, alpha * 0.8)
        pg.drawCircle(p.x, p.y, r); pg.endFill()
        pg.beginFill(0xffffff, alpha * 0.3)
        pg.drawCircle(p.x, p.y, p.size * 0.5); pg.endFill()
      })
    }

    // --- 中心光晕 ---
    if (t >= 20) {
      const burstP = Math.min(1, (t - 20) / 15)
      const glowR = (60 + burstP * 80) * S
      const glow = _celebPool.gfx()
      glow.beginFill(mainColorInt, burstP < 1 ? 0.3 : 0.15)
      glow.drawCircle(cx, cy, glowR); glow.endFill()
      glow.beginFill(mainColorInt, burstP < 1 ? 0.5 : 0.2)
      glow.drawCircle(cx, cy, glowR * 0.4); glow.endFill()
      glow.blendMode = PIXI.BLEND_MODES.ADD
    }

    // --- 宠物头像 ---
    const portraitSize = 120 * S
    if (t < 24) {
      // 旧形象（★2）
      const oldSize = 80 * S
      const fakePetOld = { id: pet.id, star: 2 }
      const ox = cx - oldSize / 2, oy = cy - oldSize / 2
      const fadeOutA = t >= 20 ? Math.max(0, 1 - (t - 20) / 4) : 1
      const alpha = Math.min(1, (t - 5) / 10) * fadeOutA
      const abg = _celebPool.gfx()
      abg.beginFill(PR.colorToInt(ac ? ac.bg : '#1a1a2e'))
      abg.drawRoundedRect(ox, oy, oldSize, oldSize, 10 * S); abg.endFill()
      abg.alpha = alpha
      const sp = _celebPool.spr(getPetAvatarPath(fakePetOld))
      sp.position.set(ox, oy); sp.width = oldSize; sp.height = oldSize; sp.alpha = alpha
    } else {
      // 新形象（★3）弹跳缩放
      const entryT = t - 24
      let scale = 1
      if (entryT < 8) {
        const p2 = entryT / 8
        scale = p2 < 0.4 ? 1.4 - 0.6 * (p2 / 0.4) :
                p2 < 0.7 ? 0.8 + 0.3 * ((p2 - 0.4) / 0.3) :
                1.1 - 0.1 * ((p2 - 0.7) / 0.3)
      }
      const sSize = portraitSize * scale
      const sx = cx - sSize / 2, sy = cy - sSize / 2
      const nbg = _celebPool.gfx()
      nbg.beginFill(PR.colorToInt(ac ? ac.bg : '#1a1a2e'))
      nbg.drawRoundedRect(sx, sy, sSize, sSize, 12 * S); nbg.endFill()
      const sp = _celebPool.spr(getPetAvatarPath(pet))
      sp.position.set(sx, sy); sp.width = sSize; sp.height = sSize
      const border = _celebPool.gfx()
      border.lineStyle(2.5 * S, mainColorInt, 1)
      border.drawRoundedRect(sx, sy, sSize, sSize, 12 * S)
    }

    // --- 三颗星逐颗亮起 ---
    if (t >= 28) {
      const starY = cy + portraitSize / 2 + 20 * S
      const starSpacing = 22 * S
      for (let si = 0; si < 3; si++) {
        const starX = cx + (si - 1) * starSpacing
        const starDelay = si * 5
        const starT = t - 28 - starDelay
        if (starT < 0) {
          const dim = _celebPool.txt('★', { fontSize: 20 * S, fill: 'rgba(100,100,100,0.3)', anchor: 0.5 })
          dim.position.set(starX, starY)
        } else {
          const sScale = starT < 6 ? 1 + 0.5 * Math.max(0, 1 - starT / 6) : 1
          const star = _celebPool.txt('★', {
            fontSize: 20 * S, fill: '#ffd700', fontWeight: 'bold', anchor: 0.5,
            stroke: 'rgba(0,0,0,0.5)', strokeThickness: 2 * S,
            dropShadow: true, dropShadowColor: '#ffd700', dropShadowBlur: 10 * S, dropShadowDistance: 0,
          })
          star.position.set(starX, starY)
          star.scale.set(sScale)
        }
      }
    }

    // --- 标题文字 ---
    if (t >= 38) {
      const titleAlpha = Math.min(1, (t - 38) / 12)
      const titleY = cy - portraitSize / 2 - 36 * S
      const unlockT = _celebPool.txt('✦ 图鉴解锁 ✦', {
        fontSize: 18 * S, fill: '#ffd700', fontWeight: 'bold', anchor: 0.5,
        stroke: 'rgba(0,0,0,0.6)', strokeThickness: 3 * S,
        dropShadow: true, dropShadowColor: '#ffd700', dropShadowBlur: 12 * S, dropShadowDistance: 0,
      })
      unlockT.position.set(cx, titleY); unlockT.alpha = titleAlpha

      const nameY = cy + portraitSize / 2 + 50 * S
      const attrName = ATTR_NAME[pet.attr] || ''
      const nameT = _celebPool.txt(`${attrName}·${pet.name}`, {
        fontSize: 15 * S, fill: mainColor, fontWeight: 'bold', anchor: 0.5,
      })
      nameT.position.set(cx, nameY); nameT.alpha = titleAlpha

      const subT = _celebPool.txt('达到满星，解锁终极形态！', {
        fontSize: 11 * S, fill: '#cccccc', anchor: 0.5,
      })
      subT.position.set(cx, nameY + 20 * S); subT.alpha = titleAlpha

      const s3 = getStar3Override(pet.id)
      if (s3 && s3.desc) {
        const s3T = _celebPool.txt(`★3技能：${s3.desc}`, {
          fontSize: 10 * S, fill: '#ffa040', anchor: 0.5,
        })
        s3T.position.set(cx, nameY + 40 * S); s3T.alpha = titleAlpha
      }
    }

    // --- "点击继续" ---
    if (c.phase === 'ready') {
      const blinkA = 0.4 + 0.4 * Math.sin(t * 0.08)
      const hintT = _celebPool.txt('— 点击屏幕继续 —', {
        fontSize: 11 * S, fill: '#aaaaaa', anchor: 0.5,
      })
      hintT.position.set(cx, H - 40 * S); hintT.alpha = blinkA
      g._star3CelebDismissRect = [0, 0, W, H]
    }

    _celebPool.hideUnused()
  }

  // =========================================================
  //  主入口：每帧调用
  // =========================================================
  function updateOverlays(g) {
    const overlay = SceneManager.overlayContainer
    if (!overlay) return

    // 计算当前 popup key
    let key = ''
    if (g._star3Celebration) {
      key = 'star3_' + (g._star3Celebration.pet ? g._star3Celebration.pet.id : '')
    } else if (g._petObtainedPopup) {
      const info = g._petObtainedPopup
      key = 'pet_' + (info.pet ? info.pet.id + '_' + (info.pet.star || 1) + '_' + info.type : '')
    }

    // 状态变化时清理
    if (key !== _lastPopupKey) {
      // 清理旧内容
      if (_staticLayer) { overlay.removeChild(_staticLayer); _staticLayer = null }
      if (_celebLayer) { overlay.removeChild(_celebLayer); _celebLayer = null }
      if (_celebPool) { _celebPool.clear(); _celebPool = null }
      // 如果还有其他残留子节点也清理
      overlay.removeChildren()
      _lastPopupKey = key

      // 构建新的静态弹窗
      if (g._petObtainedPopup && !g._star3Celebration) {
        _staticLayer = _buildPetObtainedPopup(overlay, g)
      }
    }

    // ★3庆祝（每帧更新动画）
    if (g._star3Celebration) {
      renderStar3Celebration(g)
    }
  }

  return { updateOverlays }
}

module.exports = { createOverlayRenderer }
