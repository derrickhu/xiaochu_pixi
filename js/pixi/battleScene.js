/**
 * Battle 场景原生 PixiJS 构建器
 * 【性能优化版】对象池复用，避免每帧创建/销毁对象
 * 棋盘、队伍栏、怪物区、Combo、技能快闪、胜利/失败/复活/道具/教学
 */
const PIXI = require('../libs/pixi-wrapper')

function createBattleBuilder(deps) {
  const { SceneManager, PR, W, H, S, safeTop, COLS, ROWS } = deps
  const boardPad=6*S, cellSize=(W-boardPad*2)/COLS, boardH=ROWS*cellSize, bottomPad=8*S
  const boardTop=H-bottomPad-boardH, boardX=boardPad
  const sidePad=8*S, petGap=8*S, wpnGap=12*S
  const totalGapW=wpnGap+petGap*4+sidePad*2, iconSize=(W-totalGapW)/6
  const teamBarH=iconSize+6*S, hpBarH=18*S
  const hpBarY=boardTop-hpBarH-4*S, teamBarY=hpBarY-teamBarH-2*S
  const eAreaTop=safeTop+4*S, eAreaBottom=teamBarY-4*S, exitBtnSize=32*S

  // ===== 对象池（核心性能优化） =====
  // Graphics 池
  const _gfxPool = []; let _gfxIdx = 0
  function _getGfx(parent) {
    let g
    if (_gfxIdx < _gfxPool.length) {
      g = _gfxPool[_gfxIdx]; g.clear(); g.visible = true; g.alpha = 1; g.blendMode = PIXI.BLEND_MODES.NORMAL
      if (g.parent !== parent) parent.addChild(g)
    } else {
      g = new PIXI.Graphics(); _gfxPool.push(g); parent.addChild(g)
    }
    _gfxIdx++; return g
  }
  // Text 池
  const _txtPool = []; let _txtIdx = 0
  function _getTxt(parent, str, opts) {
    let t
    if (_txtIdx < _txtPool.length) {
      t = _txtPool[_txtIdx]; t.visible = true; t.alpha = 1; t.scale.set(1); t.text = str
      const s = t.style
      s.fontSize = opts.fontSize||14*S; s.fill = opts.fill||'#eeeeee'; s.fontWeight = opts.fontWeight||'bold'
      s.stroke = opts.stroke||'transparent'; s.strokeThickness = opts.strokeThickness||0
      s.dropShadow = !!opts.dropShadow
      s.dropShadowColor = opts.dropShadowColor||'#000000'
      s.dropShadowBlur = opts.dropShadowBlur||0
      s.dropShadowDistance = opts.dropShadowDistance||0
    } else {
      t = PR.createText(str, opts); _txtPool.push(t)
    }
    if (opts.anchor !== undefined) {
      if (typeof opts.anchor === 'number') t.anchor.set(opts.anchor)
      else if (opts.anchor) t.anchor.set(opts.anchor.x||0, opts.anchor.y||0)
    }
    if (t.parent !== parent) parent.addChild(t)
    _txtIdx++; return t
  }
  // Bead Sprite 池
  const _beadPool = []; let _beadIdx = 0
  function _getBead(parent, attr, size) {
    const path = `assets/orbs/orb_${attr}.png`
    const tex = deps.AssetManager ? deps.AssetManager.getTexture(path) : null
    let sp
    if (_beadIdx < _beadPool.length) {
      sp = _beadPool[_beadIdx]; sp.visible = true; sp.alpha = 1; sp.tint = 0xffffff
      if (tex) sp.texture = tex
      if (sp.parent !== parent) parent.addChild(sp)
    } else {
      sp = tex ? new PIXI.Sprite(tex) : new PIXI.Sprite(PIXI.Texture.WHITE)
      sp.anchor.set(0.5); _beadPool.push(sp); parent.addChild(sp)
      if (!tex) {
        const AM = deps.AssetManager || require('./AssetManager')
        AM._loadTexture(path).then(lt => { if (lt && !sp.destroyed) sp.texture = lt })
      }
    }
    sp.width = size; sp.height = size; _beadIdx++; return sp
  }
  // Generic Sprite 池
  const _sprPool = []; let _sprIdx = 0
  function _getSpr(parent, path) {
    const AM = deps.AssetManager || require('./AssetManager')
    const tex = AM.getTexture(path)
    let sp
    if (_sprIdx < _sprPool.length) {
      sp = _sprPool[_sprIdx]; sp.visible = true; sp.alpha = 1; sp.tint = 0xffffff; sp.anchor.set(0,0); sp.scale.set(1)
      if (tex) { sp.texture = tex } else { sp.texture = PIXI.Texture.WHITE; sp.alpha = 0 }
      if (sp.parent !== parent) parent.addChild(sp)
    } else {
      if (tex) { sp = new PIXI.Sprite(tex) } else { sp = new PIXI.Sprite(PIXI.Texture.WHITE); sp.alpha = 0 }
      _sprPool.push(sp); parent.addChild(sp)
      if (!tex) { AM._loadTexture(path).then(lt => { if (lt && !sp.destroyed) { sp.texture = lt; sp.alpha = 1 } }) }
    }
    _sprIdx++; return sp
  }
  function _hideUnusedPool() {
    for (let i = _gfxIdx; i < _gfxPool.length; i++) { _gfxPool[i].visible = false; _gfxPool[i].clear() }
    for (let i = _txtIdx; i < _txtPool.length; i++) _txtPool[i].visible = false
    for (let i = _beadIdx; i < _beadPool.length; i++) _beadPool[i].visible = false
    for (let i = _sprIdx; i < _sprPool.length; i++) _sprPool[i].visible = false
  }
  function _resetPoolIdx() { _gfxIdx = 0; _txtIdx = 0; _beadIdx = 0; _sprIdx = 0 }
  // 池化 HP 条绘制（替代 PR.createHpBar 每帧创建6个对象）
  function _drawHpBar(parent,x,y,w,h,hp,maxHp,color,showNum) {
    const pct=Math.max(0,Math.min(1,hp/maxHp))
    const cI=PR.colorToInt(color||(pct>0.5?'#4dcc4d':pct>0.2?'#ff8c00':'#ff4d6a'))
    // 背景槽
    const bg=_getGfx(parent);bg.beginFill(0x000000,0.5);bg.drawRoundedRect(x,y,w,h,h/2);bg.endFill()
    // 填充
    if(pct>0){
      const fill=_getGfx(parent);fill.beginFill(cI);fill.drawRoundedRect(x,y,w*pct,h,h/2);fill.endFill()
      // 高光
      const hl=_getGfx(parent);hl.beginFill(0xffffff,0.3);hl.drawRoundedRect(x+2*S,y+1,w*pct-4*S,h*0.35,h/4);hl.endFill()
    }
    // 边框
    const bd=_getGfx(parent);bd.lineStyle(1,0x000000,0.3);bd.drawRoundedRect(x,y,w,h,h/2)
    // 数值
    if(showNum){const t=_getTxt(parent,`${Math.round(hp)}/${Math.round(maxHp)}`,{fontSize:Math.max(8*S,h*0.7),fill:'#ffffff',fontWeight:'bold',anchor:0.5,stroke:'#000000',strokeThickness:2*S});t.position.set(x+w/2,y+h/2)}
  }
  function _clearPools() {
    _gfxPool.length = 0; _txtPool.length = 0; _beadPool.length = 0; _sprPool.length = 0
    _resetPoolIdx()
  }

  // 缓存的静态层（背景 + 棋盘框 + 棋盘贴图）
  let _staticLayer = null
  let _staticEnemyAttr = null  // 记录当前怪物属性，切换时重建
  let _dynamicLayer = null
  // 弹窗层
  let _popupLayer = null, _popupKey = ''

  return {
    _built:false,
    build(g){this._built=true; _staticLayer=null; _clearPools(); _dynamicLayer=null; _popupLayer=null; _popupKey=''},
    update(g){
      const scene=SceneManager.getScene('battle'); if(!scene) return
      const {ATTR_COLOR,ATTR_NAME,COUNTER_MAP,COUNTER_BY,COUNTER_MUL,COUNTERED_MUL,getRealmInfo,MAX_FLOOR}=require('../data/tower')
      const {getPetStarAtk,getPetAvatarPath,MAX_STAR,getPetSkillDesc,petHasSkill}=require('../data/pets')
      const tutorial=require('../engine/tutorial')
      g.cellSize=cellSize; g.boardX=boardX; g.boardY=boardTop

      // 静态层：只在首次或怪物切换时重建
      const curEAttr = g.enemy ? g.enemy.attr + (g.enemy.name||'') : ''
      if(!_staticLayer || _staticEnemyAttr !== curEAttr) {
        scene.removeChildren()
        _clearPools(); _dynamicLayer=null; _popupLayer=null; _popupKey=''
        _staticLayer = new PIXI.Container()
        _staticLayer.name = 'static'
        scene.addChild(_staticLayer)
        _staticEnemyAttr = curEAttr
        // BG — 渐变背景
        const bg=new PIXI.Graphics()
        bg.beginFill(0x0e0b15); bg.drawRect(0,0,W,H*0.5); bg.endFill()
        bg.beginFill(0x161220); bg.drawRect(0,H*0.25,W,H*0.5); bg.endFill()
        bg.beginFill(0x0a0810); bg.drawRect(0,H*0.5,W,H*0.5); bg.endFill()
        _staticLayer.addChild(bg)
        // 怪物区背景图（静态部分）— clip + 底部对齐
        if(g.enemy){
          const e=g.enemy,battleTheme=e.attr,customBg=e.battleBg
          let bgPath=customBg?`assets/${customBg}.jpg`:null
          if(!bgPath&&battleTheme) bgPath=`assets/battle/battle_${battleTheme}.jpg`
          if(!bgPath) bgPath='assets/battle/battle_metal.jpg'
          const eAreaH=eAreaBottom-eAreaTop
          // 用 mask 裁剪到怪物区
          const bgContainer=new PIXI.Container()
          const clipMask=new PIXI.Graphics()
          clipMask.beginFill(0xffffff); clipMask.drawRect(0,eAreaTop,W,eAreaH); clipMask.endFill()
          bgContainer.mask=clipMask; _staticLayer.addChild(clipMask)
          const bgSp=PR.createSprite(bgPath)
          // 底部对齐：图片按宽度缩放，底边对齐 eAreaBottom
          bgSp.anchor.set(0,1); bgSp.position.set(0,eAreaBottom); bgSp.width=W
          // 高度按宽度比例缩放（异步纹理加载后调整）
          const adjustBgH=()=>{
            if(bgSp.texture&&bgSp.texture!==PIXI.Texture.WHITE&&bgSp.texture.width>0){
              const imgScale=W/bgSp.texture.width
              bgSp.height=bgSp.texture.height*imgScale
            } else { bgSp.height=eAreaH }
          }
          adjustBgH()
          if(bgSp.texture===PIXI.Texture.WHITE||!bgSp.texture){
            const ci=setInterval(()=>{if(bgSp.destroyed){clearInterval(ci);return};adjustBgH();if(bgSp.texture&&bgSp.texture!==PIXI.Texture.WHITE)clearInterval(ci)},100)
            setTimeout(()=>clearInterval(ci),3000)
          }
          bgContainer.addChild(bgSp)
          _staticLayer.addChild(bgContainer)
          // 轻微暗化
          const dimBg=new PIXI.Graphics()
          dimBg.beginFill(0x000000,0.15); dimBg.drawRect(0,eAreaTop,W,eAreaH); dimBg.endFill()
          _staticLayer.addChild(dimBg)
          // 底部渐变过渡（小面积，0.2高度）
          const fadeH=eAreaH*0.2
          const fadeBg=new PIXI.Graphics()
          fadeBg.beginFill(0x000000,0.5); fadeBg.drawRect(0,eAreaBottom-fadeH,W,fadeH); fadeBg.endFill()
          _staticLayer.addChild(fadeBg)
        }
        // 棋盘外框 + 贴图
        const cs=cellSize,bx=boardX,by=boardTop,bW=COLS*cs,bH2=ROWS*cs
        const bbg=new PIXI.Graphics();bbg.beginFill(0x080812,0.85);bbg.drawRoundedRect(bx-3*S,by-3*S,bW+6*S,bH2+6*S,6*S);bbg.endFill();bbg.lineStyle(1.5*S,0x505078,0.5);bbg.drawRoundedRect(bx-3*S,by-3*S,bW+6*S,bH2+6*S,6*S);_staticLayer.addChild(bbg)
        for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
          const isDark=(r+c)%2===0
          const tilePath=isDark?'assets/backgrounds/board_bg_dark1.jpg':'assets/backgrounds/board_bg_light1.jpg'
          const tileSp=PR.createSprite(tilePath)
          tileSp.position.set(bx+c*cs,by+r*cs); tileSp.width=cs; tileSp.height=cs; _staticLayer.addChild(tileSp)
          if(!tileSp.texture||tileSp.texture===PIXI.Texture.WHITE){const tBg=new PIXI.Graphics();tBg.beginFill(isDark?0x1c1c30:0x121223,0.9);tBg.drawRect(bx+c*cs,by+r*cs,cs,cs);tBg.endFill();_staticLayer.addChildAt(tBg,_staticLayer.children.length-1)}
        }
        _dynamicLayer = null  // 强制重建动态层
      }

      // 动态层：使用对象池复用，不再 removeChildren
      if(!_dynamicLayer) {
        _dynamicLayer = new PIXI.Container()
        _dynamicLayer.name = 'dynamic'
        scene.addChild(_dynamicLayer)
      }
      _resetPoolIdx()  // 重置池索引（从头复用）

      if(g.enemy) _enemyArea(_dynamicLayer,g,ATTR_COLOR,ATTR_NAME)
      _teamBar(_dynamicLayer,g,ATTR_COLOR,petHasSkill,getPetAvatarPath)
      _heroHp(_dynamicLayer,g)
      _boardDynamic(_dynamicLayer,g,ATTR_COLOR)
      _elimFloats(_dynamicLayer,g)
      _combo(_dynamicLayer,g,ATTR_COLOR,COUNTER_MAP,COUNTER_BY,COUNTER_MUL,COUNTERED_MUL)
      if(g._skillFlash) _skillFlash(_dynamicLayer,g)
      if(g._petSkillWave) _petSkillWave(_dynamicLayer,g)
      if(g.dragging&&g.bState==='playerTurn') _dragTimer(_dynamicLayer,g)
      if(g._pendingEnemyAtk&&g.bState==='playerTurn') _enemyTurnBanner(_dynamicLayer,g)
      _runBuffIcons(_dynamicLayer,g)
      _flashOverlays(_dynamicLayer,g,ATTR_COLOR)

      _hideUnusedPool()  // 隐藏本帧未使用的池对象

      // 弹窗层（低频变化，只在状态改变时重建）
      const pk = _popKey(g, tutorial)
      if(pk !== _popupKey) {
        if(!_popupLayer) { _popupLayer = new PIXI.Container(); _popupLayer.name='popup'; scene.addChild(_popupLayer) }
        _popupLayer.removeChildren()
        _popupKey = pk
        if(pk) _buildPopup(_popupLayer,g,ATTR_COLOR,ATTR_NAME,getRealmInfo,MAX_FLOOR,getPetStarAtk,getPetSkillDesc,petHasSkill,tutorial)
      }
      if(_popupLayer) { if(pk) _popupLayer.visible=true; else _popupLayer.visible=false }
    }
  }

  function _popKey(g, tutorial) {
    if(g.showExitDialog) return 'exit'
    if(g.showEnemyDetail) return 'enemyD'
    if(g.showRunBuffDetail) return 'runBuff'
    if(g.showWeaponDetail) return 'weapon'
    if(g.showBattlePetDetail!=null) return 'petD_'+g.showBattlePetDetail
    if(g._showItemMenu) return 'item'
    // skillPreview: 只区分"存在"和"消失"，不包含 timer
    if(g.skillPreview) return 'sp'
    // victory: 量化到关键阶段（每5帧一档 + 可点击后静止）
    if(g.bState==='victory'&&!require('../engine/tutorial').isActive()) {
      const vt=g._victoryAnimTimer||0
      return vt<=30?'vic_'+Math.floor(vt/5):'vic_done'
    }
    if(g.bState==='defeat') return 'defeat'
    if(g.bState==='adReviveOffer') return 'adRev'
    // tutorial: 只含 phase+step，不含 arrowTimer
    if(tutorial.isActive()) { const d=tutorial.getGuideData(); return 'tut_'+(d?d.phase+'_'+d.step:'') }
    return ''
  }

  function _buildPopup(sc,g,AC,AN,getRealmInfo,MAX_FLOOR,getPetStarAtk,getPetSkillDesc,petHasSkill,tutorial) {
    if(g.showExitDialog) _exitDialog(sc,g)
    else if(g.showEnemyDetail) _enemyDetailDialog(sc,g,AC)
    else if(g.showRunBuffDetail) _runBuffDetailDialog(sc,g)
    else if(g.showWeaponDetail) _weaponDetailDialog(sc,g)
    else if(g.showBattlePetDetail!=null) _petDetailDialog(sc,g,AC,getPetStarAtk,getPetSkillDesc,petHasSkill)
    else if(g._showItemMenu) _itemMenu(sc,g)
    else if(g.skillPreview) _skillPreview(sc,g,AC,getPetSkillDesc,petHasSkill)
    else if(g.bState==='victory'&&!tutorial.isActive()) _victoryOverlay(sc,g,getRealmInfo,MAX_FLOOR)
    else if(g.bState==='defeat') _defeatOverlay(sc,g)
    else if(g.bState==='adReviveOffer') _adReviveOverlay(sc,g)
    else if(tutorial.isActive()) _tutorial(sc,g,tutorial,petHasSkill)
  }

  /* ===== Enemy Area ===== */
  function _enemyArea(sc,g,AC,AN){
    const e=g.enemy; if(!e) return
    const ac=AC[e.attr], eAreaH=eAreaBottom-eAreaTop
    const showE=!(g.bState==='victory'&&(!g._enemyDeathAnim||g._enemyDeathAnim.done))
    if(showE){
      const avatarPath=e.avatar?e.avatar+'.png':null
      if(avatarPath){
        const maxImgH=eAreaH*0.58, maxImgW=W*0.5
        const eHpY2=eAreaBottom-26*S, imgBottom=eHpY2-6*S
        let tint=0xffffff,alpha=1
        if(g._enemyHitFlash>0){alpha=0.7+0.3*(g._enemyHitFlash/6)}
        if(g._enemyDeathAnim&&!g._enemyDeathAnim.done){const da=g._enemyDeathAnim,p=Math.min(1,da.timer/(da.duration||30));alpha=1-p;tint=0xff4444}
        const sp=_getSpr(sc,`assets/${avatarPath}`)
        sp.anchor.set(0.5,1); sp.position.set(W/2,imgBottom); sp.alpha=alpha
        if(tint!==0xffffff) sp.tint=tint
        // 限制尺寸（每帧自动检查纹理是否就绪）
        if(sp.texture&&sp.texture!==PIXI.Texture.WHITE&&sp.texture.width>0){
          const tex=sp.texture,ratio=tex.width/tex.height
          let iW=maxImgH*ratio,iH=maxImgH
          if(iW>maxImgW){iW=maxImgW;iH=iW/ratio}
          sp.width=iW;sp.height=iH
        } else { sp.width=maxImgW;sp.height=maxImgH }
        // squash 形变
        if(g._enemySquash>0){const sq=g._enemySquash/8;sp.scale.x*=(1+sq*0.15);sp.scale.y*=(1-sq*0.1)}
        if(g._enemyDeathAnim&&!g._enemyDeathAnim.done){const da=g._enemyDeathAnim,p=Math.min(1,da.timer/(da.duration||30));sp.scale.x*=(1+p*0.3);sp.scale.y*=(1-p*0.3)}
        const imgW=sp.width,imgX=(W-imgW)/2,imgY=imgBottom-sp.height
        _debuffVFX(sc,g,imgX,imgY,imgW,sp.height,AC)
      }
    }
    // Name
    const nameY=eAreaTop+8*S
    const nameStr=(e.isBoss?'👑 ':e.isElite?'💀 ':'')+e.name
    const nT=_getTxt(sc,nameStr,{fontSize:12*S,fill:'#f0e0c0',fontWeight:'bold',anchor:{x:0.5,y:0},stroke:'#000',strokeThickness:2*S})
    nT.position.set(W*0.5,nameY)
    if(AN[e.attr]){const aT=_getTxt(sc,AN[e.attr],{fontSize:9*S,fill:ac?ac.main:'#aaa',fontWeight:'bold',anchor:{x:0.5,y:0}});aT.position.set(W*0.5,nameY+16*S)}
    // HP (池化绘制，避免 createHpBar 每帧创建6个对象)
    const eHpH=14*S,eHpY=eAreaBottom-26*S,eHpW=W*0.72,eHpX=(W-eHpW)/2
    _drawHpBar(sc,eHpX,eHpY,eHpW,eHpH,e.hp,e.maxHp,ac?ac.main:'#ff4d6a',true)
    // Skill CD
    if(e.skillCd!==undefined&&e.skillCdMax){
      const cdT=_getTxt(sc,e.skillCd>0?`${e.skillCd}`:'!',{fontSize:11*S,fill:e.skillCd<=1?'#ff4d6a':'#ffd700',fontWeight:'bold',anchor:0.5,stroke:'#000',strokeThickness:2*S})
      cdT.position.set(eHpX+eHpW+12*S,eHpY+eHpH/2)
    }
    // Weakness/Resist pills
    const pillY=eHpY-18*S, pills=[]
    if(e.weakness) pills.push({text:`弱 ${AN[e.weakness]||e.weakness}`,color:'#44dd66'})
    if(e.resist) pills.push({text:`抗 ${AN[e.resist]||e.resist}`,color:'#ff6644'})
    let px2=(W-pills.reduce((s,p)=>s+p.text.length*9*S+14*S+6*S,0))/2
    pills.forEach(p=>{const pw=p.text.length*9*S+14*S;const bg2=_getGfx(sc);bg2.beginFill(PR.colorToInt(p.color),0.2);bg2.drawRoundedRect(px2,pillY,pw,16*S,4*S);bg2.endFill();bg2.lineStyle(1,PR.colorToInt(p.color),0.5);bg2.drawRoundedRect(px2,pillY,pw,16*S,4*S);const t=_getTxt(sc,p.text,{fontSize:8*S,fill:p.color,fontWeight:'bold',anchor:0.5});t.position.set(px2+pw/2,pillY+8*S);px2+=pw+6*S})
    // Floor label
    const flT=_getTxt(sc,`第 ${g.floor} 层`,{fontSize:10*S,fill:'#aaa',anchor:{x:1,y:0}});flT.position.set(W-8*S,eAreaTop+4*S)
    // Exit btn
    const eBg=_getGfx(sc);eBg.beginFill(0,0.5);eBg.drawRoundedRect(8*S,eAreaTop,exitBtnSize,exitBtnSize,6*S);eBg.endFill()
    const eT=_getTxt(sc,'✕',{fontSize:16*S,fill:'#ccc',anchor:0.5});eT.position.set(8*S+exitBtnSize/2,eAreaTop+exitBtnSize/2)
    g._exitBtnRect=[8*S,eAreaTop,exitBtnSize,exitBtnSize]
    // Chest btn
    const cX=W-exitBtnSize-8*S,cY=eAreaBottom-exitBtnSize-4*S
    const cBg=_getGfx(sc);cBg.beginFill(0,0.5);cBg.drawRoundedRect(cX,cY,exitBtnSize,exitBtnSize,6*S);cBg.endFill()
    const cT=_getTxt(sc,'📦',{fontSize:16*S,fill:'#ffd700',anchor:0.5});cT.position.set(cX+exitBtnSize/2,cY+exitBtnSize/2)
    g._chestBtnRect=[cX,cY,exitBtnSize,exitBtnSize]
    // Buff icons
    if(g.enemyBuffs&&g.enemyBuffs.length>0) _buffIcons(sc,g.enemyBuffs,eHpX,eHpY+eHpH+4*S)
    if(g.heroBuffs&&g.heroBuffs.length>0) _buffIcons(sc,g.heroBuffs,sidePad,hpBarY+hpBarH+2*S)
  }

  function _debuffVFX(sc,g,imgX,imgY,imgW,imgH,AC){
    if(g._enemyDeathAnim) return
    const hasB=g.enemyBuffs&&g.enemyBuffs.length>0, hasBD=g.enemy&&g.enemy.def===0&&g.enemy.baseDef>0
    if(!hasB&&!hasBD) return; const af=g.af||0, cx=imgX+imgW/2
    if(hasB){
      const hasDot=g.enemyBuffs.some(b=>b.type==='dot'), hasStun=g.enemyBuffs.some(b=>b.type==='stun')
      if(hasDot){const gfx=_getGfx(sc);const dots=g.enemyBuffs.filter(b=>b.type==='dot');const isBurn=dots.some(b=>b.dotType==='burn');for(let i=0;i<6;i++){const speed=0.06+(i%3)*0.02,phase=(af*speed+i*37)%(imgH*0.6),px=imgX+imgW*0.15+(i/6)*imgW*0.7,py=imgY+imgH*0.3+phase,pA=0.5-phase/(imgH*0.6)*0.5;gfx.beginFill(isBurn?0xff6020:0x40ff60,pA);gfx.drawCircle(px,py,(2+i%3)*S);gfx.endFill()}}
      if(hasStun){const gfx=_getGfx(sc),sCy=imgY+imgH*0.05,oR=imgW*0.22;gfx.lineStyle(1.5*S,0xffdd44,0.4);gfx.drawEllipse(cx,sCy,oR,oR*0.35);for(let i=0;i<5;i++){const a=(af*0.06)+(i/5)*Math.PI*2,sx=cx+Math.cos(a)*oR,sy=sCy+Math.sin(a)*oR*0.35;gfx.beginFill(i%2===0?0xffee44:0xffaa00,0.8);gfx.drawCircle(sx,sy,3*S);gfx.endFill()}}
    }
    if(hasBD){const tW=36*S,tH=14*S,tX=cx-tW/2,tY=imgY+imgH-4*S;const bg=_getGfx(sc);bg.beginFill(0xb42828,0.75);bg.drawRoundedRect(tX,tY,tW,tH,3*S);bg.endFill();const t=_getTxt(sc,'破防',{fontSize:8*S,fill:'#ffdddd',fontWeight:'bold',anchor:0.5});t.position.set(cx,tY+tH/2)}
  }

  function _buffIcons(sc,buffs,x,y){
    if(!buffs||buffs.length===0) return
    buffs.forEach((b,i)=>{const bx=x+i*26*S;const bg=_getGfx(sc);bg.beginFill(b.bad?0xb42828:0x288c32,0.7);bg.drawRoundedRect(bx,y,24*S,16*S,3*S);bg.endFill();const t=_getTxt(sc,b.name||b.type,{fontSize:7*S,fill:'#fff',anchor:0.5});t.position.set(bx+12*S,y+8*S);if(b.dur!==undefined&&b.dur<99){const dB=_getGfx(sc);dB.beginFill(0,0.6);dB.drawCircle(bx+22*S,y+2*S,5*S);dB.endFill();const dT=_getTxt(sc,`${b.dur}`,{fontSize:6*S,fill:'#ffd700',fontWeight:'bold',anchor:0.5});dT.position.set(bx+22*S,y+2*S)}})
  }

  /* ===== Team Bar ===== */
  function _teamBar(sc,g,AC,petHasSkill,getPetAvatarPath){
    g._petBtnRects=[];const iconY=teamBarY+(teamBarH-iconSize)/2
    for(let i=0;i<6;i++){
      let ix; if(i===0) ix=sidePad; else ix=sidePad+iconSize+wpnGap+(i-1)*(iconSize+petGap)
      const cx2=ix+iconSize*0.5,cy2=iconY+iconSize*0.5
      if(i===0){
        const bg=_getGfx(sc);bg.beginFill(g.weapon?0x1a1510:0x191612,0.8);bg.drawRect(ix,iconY,iconSize,iconSize);bg.endFill()
        if(g.weapon){const sp=_getSpr(sc,`assets/equipment/fabao_${g.weapon.id}.png`);sp.position.set(ix+1,iconY+1);sp.width=iconSize-2;sp.height=iconSize-2}
        const fr=_getGfx(sc);fr.lineStyle(2*S,0xc8a84e,0.8);fr.drawRect(ix-1,iconY-1,iconSize+2,iconSize+2)
        g._weaponBtnRect=[ix,iconY,iconSize,iconSize]
      } else {
        const pi=i-1
        if(pi<g.pets.length){
          const p=g.pets[pi],ac=AC[p.attr],ready=petHasSkill(p)&&p.currentCd<=0
          let bY=0;const aN=g.petAtkNums&&g.petAtkNums.find(f=>f.petIdx===pi&&f.t<=f.rollFrames)
          if(aN) bY=-Math.sin((aN.t/aN.rollFrames)*Math.PI)*6*S
          const pbg=_getGfx(sc);pbg.beginFill(ac?PR.colorToInt(ac.bg):0x1a1a2e);pbg.drawRect(ix,iconY+bY,iconSize,iconSize);pbg.endFill()
          const av=_getSpr(sc,getPetAvatarPath(p));av.position.set(ix+1,iconY+bY+1);av.width=iconSize-2;av.height=iconSize-2
          const fp=`assets/ui/frame_pet_${p.attr||'metal'}.png`,fSc=1.12,fSz=iconSize*fSc,fOff=(fSz-iconSize)/2
          const fs=_getSpr(sc,fp);fs.position.set(ix-fOff,iconY+bY-fOff);fs.width=fSz;fs.height=fSz
          if((p.star||1)>=1){const sT=_getTxt(sc,'★'.repeat(p.star||1),{fontSize:iconSize*0.14,fill:'#ffd700',fontWeight:'bold',anchor:{x:0,y:1},stroke:'#000',strokeThickness:2*S});sT.position.set(ix+2*S,iconY+bY+iconSize-2*S)}
          if(!ready&&petHasSkill(p)&&p.currentCd>0){const cdR=iconSize*0.2;const cBg=_getGfx(sc);cBg.beginFill(0,0.75);cBg.drawCircle(ix+iconSize-2*S,iconY+bY+iconSize-2*S,cdR);cBg.endFill();const cT=_getTxt(sc,`${p.currentCd}`,{fontSize:iconSize*0.22,fill:'#ffd700',fontWeight:'bold',anchor:0.5});cT.position.set(ix+iconSize-2*S,iconY+bY+iconSize-2*S)}
          if(ready){
            const canAct=g.bState==='playerTurn'&&!g.dragging,gc=ac?PR.colorToInt(ac.main):0xffd700,t=g.af*0.08,pulse=0.5+0.5*Math.sin(t*1.2)
            const gb=_getGfx(sc);gb.lineStyle((2.5+pulse*1.5)*S,gc,canAct?0.6+pulse*0.35:0.45);gb.drawRect(ix-2,iconY+bY-2,iconSize+4,iconSize+4)
            const aS=iconSize*(canAct?0.26:0.2),bounce2=canAct?Math.sin(t*1.5)*4*S:0,aY=iconY+bY-aS-3*S-bounce2
            const ar=_getGfx(sc);ar.beginFill(gc,canAct?0.7+pulse*0.3:0.5);ar.moveTo(cx2,aY);ar.lineTo(cx2-aS*0.7,aY+aS*0.7);ar.lineTo(cx2+aS*0.7,aY+aS*0.7);ar.closePath();ar.endFill()
            if(canAct){const lW=iconSize*0.7,lH=iconSize*0.2,lBg=_getGfx(sc);lBg.beginFill(gc,0.85+pulse*0.15);lBg.drawRoundedRect(cx2-lW/2,iconY+bY+iconSize+2*S,lW,lH,3*S);lBg.endFill();const lT=_getTxt(sc,'▲技能',{fontSize:iconSize*0.13,fill:'#fff',fontWeight:'bold',anchor:0.5});lT.position.set(cx2,iconY+bY+iconSize+2*S+lH/2)}
          }
          g._petBtnRects.push([ix,iconY,iconSize,iconSize])
        } else {
          const eBg=_getGfx(sc);eBg.beginFill(0x12121e,0.6);eBg.drawRect(ix,iconY,iconSize,iconSize);eBg.endFill()
          g._petBtnRects.push([ix,iconY,iconSize,iconSize])
        }
      }
    }
  }

  /* ===== Hero HP ===== */
  function _heroHp(sc,g){
    const px=8*S; _drawHpBar(sc,px,hpBarY,W-px*2,hpBarH,g.heroHp,g.heroMaxHp,'#4dcc4d',true)
    if(g.heroShield>0){const pct=Math.min(1,g.heroShield/g.heroMaxHp);const sb=_getGfx(sc);sb.beginFill(0x44ddff,0.5);sb.drawRoundedRect(px,hpBarY,(W-px*2)*pct,hpBarH,hpBarH/2);sb.endFill()}
  }

  /* ===== Board Dynamic (beads, effects) ===== */
  function _boardDynamic(sc,g,AC){
    const cs=cellSize,bx=boardX,by=boardTop
    // Elim highlight
    if(g.elimAnimCells&&g.elimAnimCells.length>0&&g.bState==='elimAnim'){
      const eGfx=_getGfx(sc),eP=Math.min(1,(g.elimAnimTimer||0)/12)
      g.elimAnimCells.forEach(cell=>{const ac=AC[cell.attr],color=ac?PR.colorToInt(ac.main):0xffffff;eGfx.beginFill(color,(1-eP)*0.6);eGfx.drawRect(bx+cell.c*cs,by+cell.r*cs,cs,cs);eGfx.endFill()})
      eGfx.blendMode=PIXI.BLEND_MODES.ADD
    }
    // Beads
    if(g.board){for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
      const cell=g.board[r][c]; if(!cell) continue
      let bSc=1,bA=1
      if(g.elimAnimCells&&g.bState==='elimAnim'){const isE=g.elimAnimCells.some(e=>e.r===r&&e.c===c);if(isE){const eP=Math.min(1,(g.elimAnimTimer||0)/12);bSc=1-eP*0.8;bA=1-eP}}
      let dropOff=0;if(g._dropAnims&&g._dropAnims.length>0){const da=g._dropAnims.find(d=>d.r===r&&d.c===c);if(da) dropOff=da.offset||0}
      if(g.dragging&&g.dragR===r&&g.dragC===c) continue
      const px=bx+c*cs+cs/2,py=by+r*cs+cs/2+dropOff
      const bSp=_getBead(sc,cell.attr,cs*0.84*bSc);bSp.position.set(px,py);bSp.alpha=bA
      if(cell.sealed){const sG=_getGfx(sc);sG.lineStyle(2*S,0x888888,0.6);sG.drawRect(bx+c*cs+2,by+r*cs+2,cs-4,cs-4);const sT=_getTxt(sc,'🔒',{fontSize:cs*0.3,anchor:0.5});sT.position.set(px,py)}
      if(g._convertAnims){const ca=g._convertAnims.find(a=>a.r===r&&a.c===c);if(ca&&ca.timer<ca.duration){const cp=ca.timer/ca.duration;const glow=_getGfx(sc);glow.beginFill(0xffffff,(1-cp)*0.5);glow.drawCircle(px,py,cs*0.4*(1+cp*0.5));glow.endFill();glow.blendMode=PIXI.BLEND_MODES.ADD}}    }}
    // Drag bead
    if(g.dragging&&g.board&&g.board[g.dragR]&&g.board[g.dragR][g.dragC]){
      const dc=g.board[g.dragR][g.dragC],dSp=_getBead(sc,dc.attr,cs*0.92);dSp.position.set(g.dragCurX,g.dragCurY);dSp.alpha=0.9
      if(g._dragTrail&&g._dragTrail.length>0){const tG=_getGfx(sc);g._dragTrail.forEach(pt=>{const tA=Math.max(0,1-pt.age/(pt.maxAge||20));const ac=AC[dc.attr];tG.beginFill(ac?PR.colorToInt(ac.main):0xffffff,tA*0.4);tG.drawCircle(pt.x,pt.y,(3-pt.age/(pt.maxAge||20)*2)*S);tG.endFill()})}
    }
    // Shockwaves
    if(g._elimShockwaves&&g._elimShockwaves.length>0){g._elimShockwaves.forEach(sw=>{const p=sw.timer/(sw.duration||15);if(p>=1) return;const ac=AC[sw.attr],color=ac?PR.colorToInt(ac.main):0xffffff;const ring=_getGfx(sc);ring.lineStyle((3-p*2)*S,color,(1-p)*0.5);ring.drawCircle(sw.x,sw.y,sw.radius*p);ring.blendMode=PIXI.BLEND_MODES.ADD})}
  }

  /* ===== Elim Floats ===== */
  function _elimFloats(sc,g){if(!g.elimFloats||g.elimFloats.length===0) return;g.elimFloats.forEach(f=>{if(f.alpha<=0) return;const t=_getTxt(sc,f.text||'',{fontSize:(f.big?16:12)*S,fill:f.color||'#fff',fontWeight:'bold',anchor:0.5,stroke:'#000',strokeThickness:2*S});t.position.set(f.x,f.y);t.alpha=f.alpha||1})}

  /* ===== Combo ===== */
  function _combo(sc,g,AC,CM,CB,CMUL,CDMUL){
    if(g.combo<2||!(g.bState==='elimAnim'||g.bState==='dropping'||g.bState==='preAttack'||g.bState==='petAtkShow')) return
    const ca=g._comboAnim||{},cA=ca.alpha!=null?Math.max(ca.alpha,0):1,cOff=ca.offsetY||0,cSc=ca.scale||1
    const cCx=W*0.5,isLow=g.combo<4,cCy=isLow?g.boardY+(ROWS*cellSize)*0.12+cOff:g.boardY+(ROWS*cellSize)*0.32+cOff
    const isH=g.combo>=5,isSu=g.combo>=8,isM=g.combo>=12
    const mainC=isM?'#ff2050':isSu?'#ff4d6a':isH?'#ff8c00':'#ffd700'
    const bSz=isM?52*S:isSu?44*S:isH?38*S:isLow?22*S:32*S
    const lowA=isLow?0.5:1
    let cMul;if(g.combo<=8) cMul=1+(g.combo-1)*0.35;else if(g.combo<=12) cMul=1+7*0.35+(g.combo-8)*0.20;else cMul=1+7*0.35+4*0.20+(g.combo-12)*0.10
    const cbP=(g.runBuffs&&g.runBuffs.comboDmgPct)||0,tMul=cMul*(1+cbP/100),eP=Math.round((tMul-1)*100)
    let eDmg=0;const pdm=g._pendingDmgMap||{};for(const attr in pdm){let d=pdm[attr]*tMul;d*=1+((g.runBuffs&&g.runBuffs.allDmgPct)||0)/100;d*=1+(((g.runBuffs&&g.runBuffs.attrDmgPct)&&g.runBuffs.attrDmgPct[attr])||0)/100;if(g.weapon&&g.weapon.type==='attrDmgUp'&&g.weapon.attr===attr) d*=1+g.weapon.pct/100;if(g.weapon&&g.weapon.type==='allAtkUp') d*=1+g.weapon.pct/100;if(g.enemy){if(CM[attr]===g.enemy.attr) d*=CMUL;else if(CB[attr]===g.enemy.attr) d*=CDMUL};eDmg+=d};eDmg=Math.round(eDmg)
    if(!isLow){const mBg=_getGfx(sc);mBg.beginFill(0,0.45*cA*lowA);mBg.drawRect(0,cCy-bSz*1.2,W,bSz*2.8);mBg.endFill()}
    const cT=_getTxt(sc,`${g.combo} 连击`,{fontSize:bSz,fill:mainC,fontWeight:'bold',anchor:0.5,stroke:'#000',strokeThickness:5*S,dropShadow:isH,dropShadowColor:mainC,dropShadowBlur:isH?12*S:0,dropShadowDistance:0})
    cT.position.set(cCx,cCy);cT.alpha=cA*lowA;cT.scale.set(cSc)
    const dA=(ca.dmgAlpha||0)*cA
    if(dA>0){
      const dSz=bSz*0.7,dCy=cCy+bSz*0.72,dTxt=eDmg>0?`额外伤害 ${eDmg}`:`额外伤害 ${eP}%`
      const dT=_getTxt(sc,dTxt,{fontSize:dSz,fill:'#ff4d60',fontWeight:'bold',anchor:0.5,stroke:'#000',strokeThickness:5*S,dropShadow:true,dropShadowColor:'#ff2040',dropShadowBlur:12*S,dropShadowDistance:0})
      dT.position.set(cCx,dCy);dT.alpha=dA;dT.scale.set(ca.dmgScale||1)
      const tipTxt=cbP>0?`x${tMul.toFixed(2)}倍率 (含Combo加成${cbP}%)`:`x${tMul.toFixed(2)}倍率`
      const tipT=_getTxt(sc,tipTxt,{fontSize:bSz*0.26,fill:'#ffe6d2',fontWeight:'bold',anchor:0.5,stroke:'#000',strokeThickness:2.5*S})
      tipT.position.set(cCx,dCy+dSz*0.8);tipT.alpha=dA
    }
    if(g._comboParticles&&g._comboParticles.length>0){const pg=_getGfx(sc);g._comboParticles.forEach(p=>{const lP=p.t/p.life,a=lP<0.3?1:1-(lP-0.3)/0.7,sz=p.size*(lP<0.2?0.5+lP/0.2*0.5:1-(lP-0.2)*0.4);pg.beginFill(PR.colorToInt(p.color),a*0.9);pg.drawCircle(p.x,p.y,sz);pg.endFill()})}
  }

  /* ===== Skill Flash ===== */
  function _skillFlash(sc,g){
    const f=g._skillFlash; if(!f) return; f.timer++; if(f.timer>f.duration){g._skillFlash=null;return}
    const t=f.timer,dur=f.duration,mA=t<=12?1:1-(t-12)/(dur-12),mS=t<=6?2-(t/6):t<=12?1+Math.sin((t-6)/6*Math.PI)*0.05:1-(t-12)/(dur-12)*0.3
    if(t<=6){const fb=_getGfx(sc);fb.beginFill(PR.colorToInt(f.color),(1-t/6)*0.3);fb.drawRect(0,0,W,H);fb.endFill()}
    if(f.skillDesc){
      const nT=_getTxt(sc,f.skillName,{fontSize:11*S,fill:f.color||'#ffd700',fontWeight:'bold',anchor:0.5,stroke:'#000',strokeThickness:2*S});nT.position.set(W*0.5,H*0.36-20*S);nT.alpha=mA*0.6;nT.scale.set(mS)
      const dT=_getTxt(sc,f.skillDesc,{fontSize:18*S,fill:'#fff',fontWeight:'bold',anchor:0.5,stroke:'#000',strokeThickness:4*S,dropShadow:true,dropShadowColor:f.color,dropShadowBlur:16*S,dropShadowDistance:0});dT.position.set(W*0.5,H*0.36+6*S);dT.alpha=mA;dT.scale.set(mS)
    } else {
      const nT=_getTxt(sc,f.skillName,{fontSize:24*S,fill:'#fff',fontWeight:'bold',anchor:0.5,stroke:'#000',strokeThickness:4*S,dropShadow:true,dropShadowColor:f.color,dropShadowBlur:20*S,dropShadowDistance:0});nT.position.set(W*0.5,H*0.36);nT.alpha=mA;nT.scale.set(mS)
    }
  }

  /* ===== Pet Skill Wave ===== */
  function _petSkillWave(sc,g){
    const w=g._petSkillWave; if(!w) return; w.timer++; if(w.timer>w.duration){g._petSkillWave=null;return}
    const t=w.timer,dur=w.duration,p=t/dur,clr=w.color||'#ffd700'
    const iY=teamBarY+(teamBarH-iconSize)/2; let ix; if(w.petIdx===0) ix=sidePad; else ix=sidePad+iconSize+wpnGap+(w.petIdx-1)*(iconSize+petGap)
    const sX=ix+iconSize*0.5,sY=iY,tX=w.targetX,tY=w.targetY
    if(!isFinite(sX)||!isFinite(sY)||!isFinite(tX)||!isFinite(tY)){g._petSkillWave=null;return}
    const gfx=_getGfx(sc),cI=PR.colorToInt(clr)
    if(p<0.15){const cP=p/0.15,cR=iconSize*0.4*cP;gfx.beginFill(0xffffff,0.6+cP*0.4);gfx.drawCircle(sX,sY,cR);gfx.endFill()}
    if(p>=0.1&&p<0.6){const fP=(p-0.1)/0.5,eP=1-Math.pow(1-fP,2),cX2=sX+(tX-sX)*eP,cY2=sY+(tY-sY)*eP,wR=18*S+fP*12*S;gfx.beginFill(cI,0.9-fP*0.3);gfx.drawCircle(cX2,cY2,wR);gfx.endFill()}
    if(p>=0.5){const hP=(p-0.5)/0.5;for(let i=0;i<16;i++){const a=(i/16)*Math.PI*2+hP*2,spd=15+(i%3)*8,d=hP*spd*S,px=tX+Math.cos(a)*d,py=tY+Math.sin(a)*d,pr=(1-hP)*(1.5+(i%4)*0.5)*S;gfx.beginFill(i%3===0?0xffffff:cI,(1-hP*hP)*0.7);gfx.drawCircle(px,py,pr);gfx.endFill()}}
    gfx.blendMode=PIXI.BLEND_MODES.ADD
  }

  /* ===== Drag Timer ===== */
  function _dragTimer(sc,g){
    const pct=Math.max(0,Math.min(1,(g.dragTimeLimit-g.dragTimer)/g.dragTimeLimit))
    const bc=pct<0.25?0xff4d6a:pct<0.5?0xff8c00:0x4dcc4d
    const rR=(cellSize-cellSize*0.08*2)*0.5+6*S, cx=g.dragCurX, cy=g.dragCurY
    const gfx=_getGfx(sc);gfx.lineStyle(4*S,0,0.4);gfx.drawCircle(cx,cy,rR)
    gfx.lineStyle(4*S,bc,1);gfx.arc(cx,cy,rR,-Math.PI/2,-Math.PI/2+Math.PI*2*pct)
  }

  /* ===== Enemy Turn Banner ===== */
  function _enemyTurnBanner(sc,g){
    const pea=g._pendingEnemyAtk; if(!pea) return; const p=Math.min(1,pea.timer/16)
    const bH=38*S,bY=safeTop+8*S,bAlpha=Math.min(1,p*1.5),offX=(1-p)*W*0.4
    const bg=_getGfx(sc);bg.beginFill(0x5a0a0a,0.85);bg.drawRect(offX,bY,W,bH);bg.endFill();bg.alpha=bAlpha
    const txt=_getTxt(sc,'敌 方 回 合',{fontSize:18*S,fill:'#ffccaa',fontWeight:'bold',anchor:0.5,stroke:'#000',strokeThickness:3.5*S,dropShadow:true,dropShadowColor:'#ff4422',dropShadowBlur:12*S,dropShadowDistance:0})
    txt.position.set(W*0.5+offX,bY+bH/2);txt.alpha=bAlpha
  }

  /* ===== Run Buff Icons ===== */
  function _runBuffIcons(sc,g){
    g._runBuffIconRects=[];const log=g.runBuffLog; if(!log||log.length===0) return
    const BL={allAtkPct:'攻',allDmgPct:'伤',heartBoostPct:'回',extraTimeSec:'时',hpMaxPct:'血',comboDmgPct:'连',elim3DmgPct:'3消',elim4DmgPct:'4消',elim5DmgPct:'5消',counterDmgPct:'克',skillDmgPct:'技',skillCdReducePct:'CD',regenPerTurn:'生',dmgReducePct:'防',bonusCombo:'C+',stunDurBonus:'晕',enemyAtkReducePct:'弱攻',enemyHpReducePct:'弱血',enemyDefReducePct:'弱防',eliteAtkReducePct:'E攻',eliteHpReducePct:'E血',bossAtkReducePct:'B攻',bossHpReducePct:'B血',extraRevive:'复活'}
    const DK=['enemyAtkReducePct','enemyHpReducePct','enemyDefReducePct','eliteAtkReducePct','eliteHpReducePct','bossAtkReducePct','bossHpReducePct']
    const merged={};for(const e of log){const k=e.buff;if(!merged[k]) merged[k]={buff:k,val:0,label:BL[k]||k,entries:[]};merged[k].val+=e.val;merged[k].entries.push(e)}
    const items=Object.values(merged);if(items.length===0) return
    const iSz=24*S,gap=4*S,tY=eAreaTop+exitBtnSize+8*S,maxS=Math.floor((eAreaBottom-tY)/(iSz+gap)),show=items.slice(0,maxS),lX=4*S
    show.forEach((it,i)=>{
      const iy=tY+i*(iSz+gap),isD=DK.includes(it.buff)
      const bg=_getGfx(sc);bg.beginFill(isD?0xb43c3c:0x1e643c,0.7);bg.drawRoundedRect(lX,iy,iSz,iSz,4*S);bg.endFill();bg.lineStyle(1,isD?0xff6464:0x64ff96,0.4);bg.drawRoundedRect(lX,iy,iSz,iSz,4*S)
      const t=_getTxt(sc,it.label,{fontSize:8*S,fill:'#fff',fontWeight:'bold',anchor:0.5});t.position.set(lX+iSz/2,iy+iSz*0.38)
      const vTxt=it.buff==='extraTimeSec'?`+${it.val.toFixed(1)}`:['bonusCombo','stunDurBonus','extraRevive','regenPerTurn'].includes(it.buff)?`+${it.val}`:`${it.val>0?'+':''}${it.val}%`
      const vt=_getTxt(sc,vTxt,{fontSize:6*S,fill:'#ffd700',anchor:0.5});vt.position.set(lX+iSz/2,iy+iSz*0.78)
      g._runBuffIconRects.push({rect:[lX,iy,iSz,iSz],data:it})
    })
  }

  /* ===== Flash Overlays ===== */
  function _flashOverlays(sc,g,AC){
    if(g._blockFlash>0){const a=(g._blockFlash/12)*0.35;const f=_getGfx(sc);f.beginFill(0x40e8ff,a);f.drawRect(0,0,W,H);f.endFill();g._blockFlash--}
    if(g._heroHurtFlash>0){const p=g._heroHurtFlash/18,a=g._heroHurtFlash>12?0.4:p*0.35;const f=_getGfx(sc);f.beginFill(0xff1e1e,a);f.drawRect(0,0,W,H);f.endFill();g._heroHurtFlash--}
    if(g._enemyWarning>0){const p=g._enemyWarning/15,a=p*0.2;const f=_getGfx(sc);f.beginFill(0xff3c1e,a);f.drawRect(0,H*0.6,W,H*0.4);f.endFill();g._enemyWarning--}
    if(g._counterFlash&&g._counterFlash.timer>0){const a=(g._counterFlash.timer/10)*0.35;const f=_getGfx(sc);f.beginFill(PR.colorToInt(g._counterFlash.color||'#ffd700'),a);f.drawRect(0,0,W,H);f.endFill()}
    if(g._comboFlash>0&&g.combo>=2){const a=(g._comboFlash/8)*0.2;const f=_getGfx(sc);f.beginFill(0xffffff,a);f.drawCircle(W*0.5,boardTop+(ROWS*cellSize)*0.32,80*S);f.endFill();f.blendMode=PIXI.BLEND_MODES.ADD}
  }

  /* ===== Victory Overlay ===== */
  function _victoryOverlay(sc,g,getRealmInfo,MAX_FLOOR){
    sc.addChild(PR.createOverlay(0,0.5))
    if(g.floor>=MAX_FLOOR){_clearPanel(sc,g,getRealmInfo);return}
    if(g._victoryAnimTimer==null) g._victoryAnimTimer=0; g._victoryAnimTimer++
    const vt=g._victoryAnimTimer,aD=30,aP=Math.min(1,vt/aD),eP=1-Math.pow(1-aP,3)
    const pW=W*0.86,pX=(W-pW)/2,iP=16*S
    const floor=g.floor,nF=floor+1,cR=getRealmInfo(floor),nR=getRealmInfo(nF)
    const cRN=cR?cR.name:'凡人',nRN=nR?nR.name:cRN,rC=nRN!==cRN,hU=nR?nR.hpUp:0
    const lines=[];if(rC) lines.push({l:'境界提升',t:`${cRN} → ${nRN}`,c:'#C07000'});else lines.push({l:'当前境界',t:cRN,c:'#7A5C30'})
    if(hU>0) lines.push({l:'血量上限',t:`${g.heroMaxHp} → ${Math.round(g.heroMaxHp+hU*eP)}`,c:'#27864A'})
    const tH=26*S,spH=g.lastSpeedKill?16*S:0,gLH=22*S,gAH=lines.length*gLH+6*S,tipH=24*S
    const totH=iP+tH+spH+gAH+tipH+iP,pY=Math.max(4*S,Math.floor((H-totH)/2))
    sc.addChild(PR.createInfoPanel(pX,pY,pW,totH))
    let cY=pY+iP;const tT=PR.createText('战斗胜利',{fontSize:15*S,fill:'#7A5C30',fontWeight:'bold',anchor:{x:0.5,y:0}});tT.position.set(W*0.5,cY);sc.addChild(tT);cY+=tH
    if(g.lastSpeedKill){const sT=PR.createText(`⚡ 速通达成 (${g.lastTurnCount}回合)`,{fontSize:9*S,fill:'#C07000',fontWeight:'bold',anchor:{x:0.5,y:0}});sT.position.set(W*0.5,cY);sc.addChild(sT);cY+=spH}
    lines.forEach(l=>{cY+=gLH;const lT=PR.createText(l.l,{fontSize:11*S,fill:'#8B7B70',anchor:{x:0,y:0.5}});lT.position.set(pX+iP,cY-4*S);sc.addChild(lT);const vT=PR.createText(l.t,{fontSize:13*S,fill:l.c,fontWeight:'bold',anchor:{x:0,y:0.5}});vT.position.set(pX+iP+80*S,cY-4*S);sc.addChild(vT)})
    if(vt>aD+10){const bA=0.4+0.4*Math.sin(vt*0.08);const tapT=PR.createText('— 点击屏幕选择奖励 —',{fontSize:10*S,fill:'#8B7B70',anchor:0.5});tapT.position.set(W*0.5,pY+totH-iP+2*S);tapT.alpha=bA;sc.addChild(tapT)}
    g._victoryTapReady=vt>aD+10;g._rewardRects=null;g._rewardConfirmRect=null
  }

  function _clearPanel(sc,g,getRealmInfo){
    const pW=W*0.86,pX=(W-pW)/2,iP=16*S,totH=280*S,pY=Math.max(4*S,Math.floor((H-totH)/2))
    sc.addChild(PR.createInfoPanel(pX,pY,pW,totH))
    let cY=pY+iP;const tT=PR.createText('通天塔·通关',{fontSize:18*S,fill:'#C07000',fontWeight:'bold',anchor:0.5});tT.position.set(W*0.5,cY+20*S);sc.addChild(tT);cY+=30*S
    const sT=PR.createText('恭喜修士登顶通天塔！',{fontSize:12*S,fill:'#7A5C30',anchor:0.5});sT.position.set(W*0.5,cY+14*S);sc.addChild(sT);cY+=24*S
    const rN=getRealmInfo(g.floor);const rT=PR.createText(`最终境界: ${rN?rN.name:'化神圆满'}`,{fontSize:12*S,fill:'#C07000',fontWeight:'bold',anchor:0.5});rT.position.set(W*0.5,cY+14*S);sc.addChild(rT);cY+=40*S
    const bW=(pW-iP*2)*0.55,bH=30*S,bX=pX+(pW-bW)/2,bY=pY+totH-iP-bH
    sc.addChild(PR.createButton(bX,bY,bW,bH,'返回主页'));g._clearConfirmRect=[bX,bY,bW,bH]
  }

  /* ===== Defeat ===== */
  function _defeatOverlay(sc,g){
    sc.addChild(PR.createOverlay(0,0.45));const pW=W*0.72,pH=120*S,pX=(W-pW)/2,pY=(H-pH)/2
    sc.addChild(PR.createDialogPanel(pX,pY,pW,pH))
    sc.addChild(Object.assign(PR.createText('修士陨落...',{fontSize:14*S,fill:'#f0e0c0',fontWeight:'bold',anchor:0.5}),{position:new PIXI.Point(W*0.5,pY+42*S)}))
    sc.addChild(Object.assign(PR.createText(`止步第 ${g.floor} 层`,{fontSize:11*S,fill:'#dcd7c8',anchor:0.5}),{position:new PIXI.Point(W*0.5,pY+62*S)}))
    const bW=pW*0.7,bH=40*S,bX=(W-bW)/2,bY=pY+pH-bH-14*S
    sc.addChild(PR.createButton(bX,bY,bW,bH,'结算'));g._defeatBtnRect=[bX,bY,bW,bH]
  }

  /* ===== Ad Revive ===== */
  function _adReviveOverlay(sc,g){
    sc.addChild(PR.createOverlay(0,0.7));const pW=W*0.78,pH=240*S,pX=(W-pW)/2,pY=H*0.28
    sc.addChild(PR.createDialogPanel(pX,pY,pW,pH))
    const t1=PR.createText('修士陨落',{fontSize:22*S,fill:'#ff4d6a',fontWeight:'bold',anchor:0.5});t1.position.set(W*0.5,pY+40*S);sc.addChild(t1)
    const t2=PR.createText('分享给好友，获得满血复活！',{fontSize:15*S,fill:'#ffd700',fontWeight:'bold',anchor:0.5});t2.position.set(W*0.5,pY+72*S);sc.addChild(t2)
    const t3=PR.createText(`当前第 ${g.floor} 层，复活后从本层继续挑战`,{fontSize:11*S,fill:'#999',anchor:0.5});t3.position.set(W*0.5,pY+98*S);sc.addChild(t3)
    const t4=PR.createText('每轮仅有一次分享复活机会',{fontSize:10*S,fill:'#777',anchor:0.5});t4.position.set(W*0.5,pY+116*S);sc.addChild(t4)
    const bW=pW*0.7,bH=44*S,bX=(W-bW)/2,bY=pY+140*S;sc.addChild(PR.createButton(bX,bY,bW,bH,'📤 分享复活'));g._adReviveBtnRect=[bX,bY,bW,bH]
    const sW=pW*0.5,sH=36*S,sX=(W-sW)/2,sY=pY+196*S;sc.addChild(PR.createButton(sX,sY,sW,sH,'放弃治疗'));g._adReviveSkipRect=[sX,sY,sW,sH]
  }

  /* ===== Skill Preview ===== */
  function _skillPreview(sc,g,AC,getPetSkillDesc,petHasSkill){
    const sp=g.skillPreview; if(!sp) return;const pet=sp.pet,sk=pet.skill; if(!sk) return
    const pW=W*0.6,pH=80*S,pX=Math.max(4*S,Math.min(W-pW-4*S,sp.x-pW/2)),pY=sp.y
    const fi=Math.min(1,sp.timer/8);const ct=new PIXI.Container();ct.alpha=fi
    const bg=new PIXI.Graphics();bg.beginFill(0x101020,0.95);bg.drawRoundedRect(pX,pY,pW,pH,10*S);bg.endFill()
    const ac=AC[pet.attr]?.main||'#ffd700';bg.beginFill(PR.colorToInt(ac));bg.drawRect(pX,pY,pW,4*S);bg.endFill()
    bg.lineStyle(1.5*S,PR.colorToInt(ac),0.5);bg.drawRoundedRect(pX,pY,pW,pH,10*S);ct.addChild(bg)
    ct.addChild(Object.assign(PR.createText(pet.name,{fontSize:11*S,fill:ac,fontWeight:'bold',anchor:{x:0,y:0.5}}),{position:new PIXI.Point(pX+10*S,pY+20*S)}))
    ct.addChild(Object.assign(PR.createText(sk.name,{fontSize:14*S,fill:'#fff',fontWeight:'bold',anchor:{x:0,y:0.5}}),{position:new PIXI.Point(pX+10*S,pY+40*S)}))
    ct.addChild(Object.assign(PR.createText(getPetSkillDesc(pet)||'无描述',{fontSize:10*S,fill:'#bbb',anchor:{x:0,y:0.5}}),{position:new PIXI.Point(pX+10*S,pY+58*S)}))
    ct.addChild(Object.assign(PR.createText(`CD: ${pet.cd}回合`,{fontSize:10*S,fill:'#ffd700',fontWeight:'bold',anchor:{x:1,y:0.5}}),{position:new PIXI.Point(pX+pW-10*S,pY+20*S)}))
    const triX=Math.max(pX+15*S,Math.min(pX+pW-15*S,sp.x));const tri=new PIXI.Graphics();tri.beginFill(0x101020,0.95);tri.moveTo(triX-8*S,pY);tri.lineTo(triX,pY-8*S);tri.lineTo(triX+8*S,pY);tri.closePath();tri.endFill();ct.addChild(tri)
    sc.addChild(ct)
  }

  /* ===== Item Menu ===== */
  function _itemMenu(sc,g){
    sc.addChild(PR.createOverlay(0,0.55));const mW=W*0.78,iH=64*S,pY=14*S,pX=14*S,gap=10*S,tH=30*S,mH=pY+tH+iH*2+gap+pY+20*S,mX=(W-mW)/2,mY=(H-mH)/2
    const p=new PIXI.Graphics();p.beginFill(0x1a1410);p.drawRoundedRect(mX,mY,mW,mH,10*S);p.endFill();p.lineStyle(2*S,0xc8a84e);p.drawRoundedRect(mX,mY,mW,mH,10*S);sc.addChild(p)
    sc.addChild(Object.assign(PR.createText('灵宝匣',{fontSize:15*S,fill:'#ffd700',fontWeight:'bold',anchor:0.5}),{position:new PIXI.Point(W*0.5,mY+pY+16*S)}))
    let cy=mY+pY+tH;const items=[{key:'reset',name:'乾坤重置',desc:'重排棋盘上所有灵珠',obtained:g.itemResetObtained,used:g.itemResetUsed,color:'#66ccff'},{key:'heal',name:'回春妙术',desc:'立即恢复全部气血',obtained:g.itemHealObtained,used:g.itemHealUsed,color:'#44ff88'}]
    g._itemMenuRects=[]
    items.forEach((it,i)=>{const iy=cy+i*(iH+gap),isU=it.used,isO=it.obtained&&!it.used,isHF=it.key==='heal'&&g.heroHp>=g.heroMaxHp,isD=isU||(isO&&isHF)
      const cBg=new PIXI.Graphics();cBg.beginFill(0x281e14,isD?0.4:0.85);cBg.drawRoundedRect(mX+pX,iy,mW-pX*2,iH,8*S);cBg.endFill();if(!isD){cBg.lineStyle(1.5*S,PR.colorToInt(it.color));cBg.drawRoundedRect(mX+pX,iy,mW-pX*2,iH,8*S)};sc.addChild(cBg)
      const iSz=42*S,iXX=mX+pX+10*S,iYY=iy+(iH-iSz)/2;const img=PR.createSprite(it.key==='reset'?'assets/ui/icon_item_reset.png':'assets/ui/icon_item_heal.png');img.position.set(iXX,iYY);img.width=iSz;img.height=iSz;if(isD) img.alpha=0.4;sc.addChild(img)
      const tX=iXX+iSz+10*S;sc.addChild(Object.assign(PR.createText(it.name,{fontSize:13*S,fill:it.color,fontWeight:'bold',anchor:{x:0,y:0.5}}),{position:new PIXI.Point(tX,iy+iH*0.38)}))
      sc.addChild(Object.assign(PR.createText(it.desc,{fontSize:10*S,fill:'#bbb',anchor:{x:0,y:0.5}}),{position:new PIXI.Point(tX,iy+iH*0.62)}))
      let stT='',stC='#888';if(isU){stT='已使用'}else if(isO&&isHF){stT='气血已满'}else if(isO){stT='点击使用';stC='#44ff88'}else{stT='分享获取';stC='#e8c870'}
      sc.addChild(Object.assign(PR.createText(stT,{fontSize:10*S,fill:stC,fontWeight:isO?'bold':'normal',anchor:{x:1,y:0.5}}),{position:new PIXI.Point(mX+mW-pX-10*S,iy+iH*0.5)}))
      if(!isD) g._itemMenuRects.push({rect:[mX+pX,iy,mW-pX*2,iH],key:it.key,action:isO?'use':'obtain'})
    })
    sc.addChild(Object.assign(PR.createText('点击空白处关闭',{fontSize:9*S,fill:'#777',anchor:0.5}),{position:new PIXI.Point(W*0.5,mY+mH-10*S)}))
  }

  /* ===== Tutorial ===== */
  function _tutorial(sc,g,tutorial,petHasSkill){
    if(!tutorial.isActive()) return;const data=tutorial.getGuideData(); if(!data) return
    // Skip button
    if(!data.isSummary){const sW=76*S,sH=34*S,sX=W-sW-10*S,sY=boardTop-sH-8*S;const sBg=new PIXI.Graphics();sBg.beginFill(0x3c3228,0.88);sBg.drawRoundedRect(sX,sY,sW,sH,8*S);sBg.endFill();sBg.lineStyle(1.5*S,0xffc850,0.6);sBg.drawRoundedRect(sX,sY,sW,sH,8*S);sc.addChild(sBg);sc.addChild(Object.assign(PR.createText('跳过 ▶',{fontSize:12*S,fill:'#ffd080',fontWeight:'bold',anchor:0.5}),{position:new PIXI.Point(sX+sW/2,sY+sH/2)}));g._tutorialSkipRect=[sX,sY,sW,sH]}
    // Summary
    if(data.isSummary){sc.addChild(PR.createOverlay(0,0.7));const pW=W*0.82,pH=260*S,pX2=(W-pW)/2,pY2=(H-pH)/2;sc.addChild(PR.createInfoPanel(pX2,pY2,pW,pH));sc.addChild(Object.assign(PR.createText('修仙要诀',{fontSize:16*S,fill:'#C07000',fontWeight:'bold',anchor:0.5}),{position:new PIXI.Point(W*0.5,pY2+36*S)}));const tips=['① 按住拖动灵珠排列三连消除','② Combo越多伤害越高','③ 克制x2.5 被克x0.5','④ 上划释放宠物技能','⑤ 粉色心珠回复生命'];tips.forEach((t,i)=>{sc.addChild(Object.assign(PR.createText(t,{fontSize:11*S,fill:'#3D2B1F',anchor:0.5}),{position:new PIXI.Point(W*0.5,pY2+66*S+i*24*S)}))});sc.addChild(Object.assign(PR.createText('点击屏幕继续',{fontSize:9*S,fill:'#8B7B70',anchor:0.5}),{position:new PIXI.Point(W*0.5,pY2+pH-10*S)}));return}
    // Intro
    if(data.phase==='intro'){const a=Math.min(1,data.introTimer/30);sc.addChild(PR.createOverlay(0,a*0.6));if(data.round===0){sc.addChild(Object.assign(PR.createText(`第${data.step+1}课`,{fontSize:13*S,fill:'#C07000',fontWeight:'bold',anchor:0.5}),{position:new PIXI.Point(W*0.5,H*0.38),alpha:a}));sc.addChild(Object.assign(PR.createText(data.title,{fontSize:20*S,fill:'#ffd700',fontWeight:'bold',anchor:0.5}),{position:new PIXI.Point(W*0.5,H*0.44),alpha:a}));const sm=data.msgs.find(m=>m.timing==='start');if(sm) sc.addChild(Object.assign(PR.createText(sm.text,{fontSize:12*S,fill:'#fff',anchor:0.5}),{position:new PIXI.Point(W*0.5,H*0.52),alpha:a}));sc.addChild(Object.assign(PR.createText('点击屏幕开始',{fontSize:9*S,fill:'rgba(255,255,255,0.5)',anchor:0.5}),{position:new PIXI.Point(W*0.5,H*0.60),alpha:a}))}else{sc.addChild(PR.createOverlay(0,a*0.45));const sm=data.msgs.find(m=>m.timing==='start');if(sm) sc.addChild(Object.assign(PR.createText(sm.text,{fontSize:14*S,fill:'#ffd700',fontWeight:'bold',anchor:0.5}),{position:new PIXI.Point(W*0.5,H*0.45),alpha:a}));sc.addChild(Object.assign(PR.createText('点击屏幕继续',{fontSize:9*S,fill:'rgba(255,255,255,0.5)',anchor:0.5}),{position:new PIXI.Point(W*0.5,H*0.54),alpha:a}))}return}
    // Play phase: guide arrow + path
    if(data.phase==='play'){
      const cs=cellSize,bx=boardX,by=boardTop
      // Step label
      const lW=80*S,lH=22*S,lX2=(W-lW)/2,lY=by-32*S;const lBg=new PIXI.Graphics();lBg.beginFill(0,0.6);lBg.drawRoundedRect(lX2,lY,lW,lH,4*S);lBg.endFill();sc.addChild(lBg);sc.addChild(Object.assign(PR.createText(`教学 ${data.step+1}/4`,{fontSize:10*S,fill:'#ffd700',fontWeight:'bold',anchor:0.5}),{position:new PIXI.Point(lX2+lW/2,lY+lH/2)}))
      // Guide arrow
      if(data.guide&&!data.guideDone&&g.bState==='playerTurn'&&!g.dragging){
        const guide=data.guide,t=data.arrowTimer
        const startCX=bx+guide.fromC*cs+cs/2,startCY=by+guide.fromR*cs+cs/2
        const pulse=0.6+0.4*Math.sin(t*0.12)
        // Start glow
        const sG=new PIXI.Graphics();sG.lineStyle(3.5*S,0xffcc00,0.7+pulse*0.3);sG.drawRect(bx+guide.fromC*cs+1,by+guide.fromR*cs+1,cs-2,cs-2);sc.addChild(sG)
        sc.addChild(Object.assign(PR.createText('按住',{fontSize:9*S,fill:'#fff',fontWeight:'bold',anchor:{x:0.5,y:1},stroke:'#000',strokeThickness:2*S}),{position:new PIXI.Point(startCX,by+guide.fromR*cs-2*S)}))
        // Path cells
        const path=guide.path;if(path&&path.length>2){const pG=new PIXI.Graphics();for(let pi=1;pi<path.length;pi++){const[pr,pc]=path[pi],cX=bx+pc*cs,cY2=by+pr*cs,wA=0.25+0.2*Math.sin((t*0.1+pi*1.2)%(Math.PI*2));pG.lineStyle(2*S,0x44ddff,wA+0.15);pG.drawRect(cX+2,cY2+2,cs-4,cs-4);const nT=PR.createText(`${pi}`,{fontSize:11*S,fill:'#fff',fontWeight:'bold',anchor:0.5,stroke:'#000',strokeThickness:2.5*S});nT.position.set(cX+cs/2,cY2+cs/2);sc.addChild(nT)};sc.addChild(pG)}
        // Path line
        if(path&&path.length>=2){const lG=new PIXI.Graphics();lG.lineStyle(3*S,0xffe664,0.65);for(let i=0;i<path.length;i++){const px=bx+path[i][1]*cs+cs/2,py=by+path[i][0]*cs+cs/2;if(i===0) lG.moveTo(px,py);else lG.lineTo(px,py)};sc.addChild(lG)
          // Finger
          const aDur=Math.max(150,path.length*35),prog=(t%aDur)/aDur,tSegs=path.length-1,sF=prog*tSegs,sIdx=Math.min(Math.floor(sF),tSegs-1),sProg=sF-sIdx
          const[r1,c1]=path[sIdx],[r2,c2]=path[Math.min(sIdx+1,path.length-1)]
          const fX=bx+(c1+(c2-c1)*sProg)*cs+cs/2,fY=by+(r1+(r2-r1)*sProg)*cs+cs/2
          const fA=prog<0.08?prog/0.08:prog>0.88?(1-prog)/0.12:1
          const fG=new PIXI.Graphics();fG.beginFill(0xffffff,fA*0.92);fG.drawCircle(fX,fY+10*S,10*S);fG.moveTo(fX,fY-4*S);fG.lineTo(fX-7*S,fY+10*S);fG.lineTo(fX+7*S,fY+10*S);fG.closePath();fG.endFill();sc.addChild(fG)
        }
        // End marker
        if(path&&path.length>=2){const lastP=path[path.length-1],eX=bx+lastP[1]*cs+cs/2,eY=by+lastP[0]*cs+cs/2,eP2=0.5+0.5*Math.sin(t*0.15);const eR=new PIXI.Graphics();eR.lineStyle(2.5*S,0xff6644,0.6+eP2*0.4);eR.drawCircle(eX,eY,cs*0.35);sc.addChild(eR)}
      }
      // afterElim message
      if(data.afterElimShown){const aM=data.msgs.find(m=>m.timing==='afterElim');if(aM){const mW=W*0.85,mH=30*S,mX=(W-mW)/2,mY=by-60*S;const mBg=new PIXI.Graphics();mBg.beginFill(0,0.7);mBg.drawRoundedRect(mX,mY,mW,mH,6*S);mBg.endFill();sc.addChild(mBg);sc.addChild(Object.assign(PR.createText(aM.text,{fontSize:10*S,fill:'#ffd700',fontWeight:'bold',anchor:0.5}),{position:new PIXI.Point(W*0.5,mY+mH/2)}))}}
      // Skill ready (step 3)
      if(data.step===3){const rPI=g.pets.findIndex(p=>petHasSkill(p)&&p.currentCd<=0);if(rPI>=0&&g.bState==='playerTurn'&&!g.dragging){const sM=data.msgs.find(m=>m.timing==='skillReady');if(sM&&g._petBtnRects&&g._petBtnRects[rPI]){const[px2,py2,pw2]=g._petBtnRects[rPI];const aX=px2+pw2/2,aY2=py2-20*S-Math.sin(g.af*0.1)*5*S;const aG=new PIXI.Graphics();aG.beginFill(0xffd700,0.8+0.2*Math.sin(g.af*0.08));aG.moveTo(aX,aY2);aG.lineTo(aX-8*S,aY2-12*S);aG.lineTo(aX+8*S,aY2-12*S);aG.closePath();aG.endFill();sc.addChild(aG);const mW2=W*0.78,mH2=28*S,mX2=(W-mW2)/2,mY2=py2-60*S;const mBg2=new PIXI.Graphics();mBg2.beginFill(0,0.7);mBg2.drawRoundedRect(mX2,mY2,mW2,mH2,6*S);mBg2.endFill();sc.addChild(mBg2);sc.addChild(Object.assign(PR.createText(sM.text,{fontSize:10*S,fill:'#ffd700',fontWeight:'bold',anchor:0.5}),{position:new PIXI.Point(W*0.5,mY2+mH2/2)}))}}}
      // Tutorial victory hint
      if(g.bState==='victory'&&data.step<3){sc.addChild(PR.createOverlay(0,0.5));sc.addChild(Object.assign(PR.createText('通过！',{fontSize:18*S,fill:'#ffd700',fontWeight:'bold',anchor:0.5}),{position:new PIXI.Point(W*0.5,H*0.42)}));const sM=['记住：拖珠与路上的珠子交换位置！','Combo让你更强！心珠是你的生命线！','克制属性造成2.5倍伤害，被克只有0.5倍！'];sc.addChild(Object.assign(PR.createText(sM[data.step],{fontSize:12*S,fill:'#fff',anchor:0.5}),{position:new PIXI.Point(W*0.5,H*0.50)}));sc.addChild(Object.assign(PR.createText('点击继续',{fontSize:10*S,fill:'rgba(255,255,255,0.7)',anchor:0.5}),{position:new PIXI.Point(W*0.5,H*0.58)}))}
    }
  }
}

/* ===== 退出确认弹窗 ===== */
function _exitDialog(sc,g){
  sc.addChild(PR.createOverlay(0,0.7))
  const pw=W*0.78,ph=185*S,px=(W-pw)/2,py=(H-ph)/2
  // 面板
  const panel=PR.createDialogPanel(px,py,pw,ph); sc.addChild(panel)
  // 标题
  sc.addChild(Object.assign(PR.createText('退出战斗',{fontSize:16*S,fill:'#f0e0c0',fontWeight:'bold',anchor:0.5,dropShadow:true,dropShadowColor:'#000',dropShadowDistance:1,dropShadowBlur:3*S}),{position:new PIXI.Point(px+pw*0.5,py+46*S)}))
  sc.addChild(Object.assign(PR.createText('请选择退出方式',{fontSize:11*S,fill:'rgba(200,190,170,0.7)',anchor:0.5}),{position:new PIXI.Point(px+pw*0.5,py+66*S)}))
  // 两主按钮
  const btnW=pw*0.34,btnH=34*S,gap=12*S
  const btn1X=px+pw*0.5-btnW-gap*0.5,btn2X=px+pw*0.5+gap*0.5,btnY=py+86*S
  sc.addChild(PR.createButton({x:btn1X,y:btnY,w:btnW,h:btnH,text:'暂存退出',color:'#8B7355'}))
  g._exitSaveRect=[btn1X,btnY,btnW,btnH]
  sc.addChild(PR.createButton({x:btn2X,y:btnY,w:btnW,h:btnH,text:'重新开局',color:'#C0392B'}))
  g._exitRestartRect=[btn2X,btnY,btnW,btnH]
  // 取消按钮
  const cancelW=pw*0.30,cancelH=28*S,cancelX=px+(pw-cancelW)/2,cancelY=btnY+btnH+14*S
  const cBg=new PIXI.Graphics();cBg.beginFill(0x282332,0.6);cBg.drawRoundedRect(cancelX,cancelY,cancelW,cancelH,cancelH*0.5);cBg.endFill()
  cBg.lineStyle(1*S,0xb4aa96,0.3);cBg.drawRoundedRect(cancelX,cancelY,cancelW,cancelH,cancelH*0.5);sc.addChild(cBg)
  sc.addChild(Object.assign(PR.createText('取消',{fontSize:11*S,fill:'rgba(200,190,170,0.6)',anchor:0.5}),{position:new PIXI.Point(cancelX+cancelW*0.5,cancelY+cancelH*0.5)}))
  g._exitCancelRect=[cancelX,cancelY,cancelW,cancelH]
}

/* ===== 全局增益详情弹窗 ===== */
function _runBuffDetailDialog(sc,g){
  const log=g.runBuffLog; if(!log||log.length===0){g.showRunBuffDetail=false;return}
  sc.addChild(PR.createOverlay(0,0.7))
  const BUFF_LABELS={allAtkPct:'全队攻击',allDmgPct:'全属性伤害',heartBoostPct:'心珠回复',weaponBoostPct:'法宝效果',extraTimeSec:'转珠时间',hpMaxPct:'血量上限',comboDmgPct:'Combo伤害',elim3DmgPct:'3消伤害',elim4DmgPct:'4消伤害',elim5DmgPct:'5消伤害',counterDmgPct:'克制伤害',skillDmgPct:'技能伤害',skillCdReducePct:'技能CD缩短',regenPerTurn:'每回合回血',dmgReducePct:'受伤减少',bonusCombo:'额外连击',stunDurBonus:'眩晕延长',enemyAtkReducePct:'怪物攻击降低',enemyHpReducePct:'怪物血量降低',enemyDefReducePct:'怪物防御降低',eliteAtkReducePct:'精英攻击降低',eliteHpReducePct:'精英血量降低',bossAtkReducePct:'BOSS攻击降低',bossHpReducePct:'BOSS血量降低',nextDmgReducePct:'下场受伤减少',postBattleHealPct:'战后回血',extraRevive:'额外复活'}
  const merged={};for(const entry of log){const k=entry.buff;if(!merged[k])merged[k]={buff:k,val:0,count:0};merged[k].val+=entry.val;merged[k].count++}
  const items=Object.values(merged),padX=16*S,padY=14*S,lineH=18*S,titleH=24*S
  const tipW=W*0.88,contentH=titleH+items.length*lineH+padY*2+10*S,tipH=Math.min(contentH,H*0.7)
  const tipX=(W-tipW)/2,tipY=(H-tipH)/2
  const panel=PR.createDialogPanel(tipX,tipY,tipW,tipH);sc.addChild(panel)
  sc.addChild(Object.assign(PR.createText('全局增益一览',{fontSize:14*S,fill:'#ffd700',fontWeight:'bold',anchor:0.5}),{position:new PIXI.Point(W*0.5,tipY+padY+12*S)}))
  let ly=tipY+padY+titleH+4*S
  for(const it of items){
    if(ly+lineH>tipY+tipH-padY) break
    const name=BUFF_LABELS[it.buff]||it.buff
    const valTxt=it.buff==='extraTimeSec'?`+${it.val.toFixed(1)}s`:(it.buff==='bonusCombo'||it.buff==='stunDurBonus'||it.buff==='extraRevive'||it.buff==='regenPerTurn'?`+${it.val}`:`${it.val>0?'+':''}${it.val}%`)
    const countTxt=it.count>1?` (x${it.count})`:''
    sc.addChild(Object.assign(PR.createText(`· ${name}`,{fontSize:11*S,fill:'#ddd',anchor:{x:0,y:0.5}}),{position:new PIXI.Point(tipX+padX,ly+6*S)}))
    sc.addChild(Object.assign(PR.createText(`${valTxt}${countTxt}`,{fontSize:11*S,fill:'#ffd700',fontWeight:'bold',anchor:{x:1,y:0.5}}),{position:new PIXI.Point(tipX+tipW-padX,ly+6*S)}))
    ly+=lineH
  }
  sc.addChild(Object.assign(PR.createText('点击任意位置关闭',{fontSize:9*S,fill:'rgba(140,140,160,0.5)',anchor:0.5}),{position:new PIXI.Point(W*0.5,tipY+tipH-8*S)}))
}

/* ===== 敌人详情弹窗 ===== */
function _enemyDetailDialog(sc,g,AC){
  if(!g.enemy) return
  const e=g.enemy,ac=AC[e.attr],padX=16*S,padY=14*S,lineH=18*S,smallLineH=15*S,tipW=W*0.86
  const {ENEMY_SKILLS}=require('../data/tower')
  sc.addChild(PR.createOverlay(0,0.45))
  // 构建文本行
  let lines=[]
  const typeTag=e.isBoss?'【BOSS】':(e.isElite?'【精英】':'')
  const tagColor=e.isBoss?'#C0392B':(e.isElite?'#7B2FBE':null)
  lines.push({text:`${typeTag}${e.name}`,color:'#3D2B1F',bold:true,size:14,h:lineH+2*S,tagColor})
  lines.push({text:`第 ${g.floor} 层`,color:'#6B5B50',size:10,h:smallLineH,attrOrb:e.attr})
  lines.push({text:`HP：${Math.round(e.hp)} / ${Math.round(e.maxHp)}　ATK：${e.atk}　DEF：${e.def||0}`,color:'#3D2B1F',size:10,h:smallLineH})
  if(e.skills&&e.skills.length>0){
    lines.push({h:4*S}); lines.push({text:'技能列表：',color:'#8B6914',bold:true,size:11,h:smallLineH})
    e.skills.forEach(sk=>{const skData=ENEMY_SKILLS[sk];if(skData){lines.push({text:`· ${skData.name}`,color:'#7A5C30',bold:true,size:10,h:smallLineH});let desc=skData.desc||'';if(desc.includes('{val}')){const val=skData.type==='dot'?Math.round(e.atk*0.3):Math.round(e.atk*0.8);desc=desc.replace('{val}',val)}_wrapDialog(desc,tipW-padX*2-8*S,9).forEach(dl=>{lines.push({text:`  ${dl}`,color:'#6B5B50',size:9,h:smallLineH-2*S})})}})
  }
  if(g.enemyBuffs&&g.enemyBuffs.length>0){lines.push({h:4*S});lines.push({text:'敌方状态：',color:'#C0392B',bold:true,size:11,h:smallLineH});g.enemyBuffs.forEach(b=>{const dur=b.dur<99?` (${b.dur}回合)`:'';lines.push({text:`· ${b.name||b.type}${dur}`,color:b.bad?'#C0392B':'#27864A',size:9,h:smallLineH-2*S})})}
  const hasBreakDef=e.def===0&&e.baseDef>0;if(hasBreakDef){if(!(g.enemyBuffs&&g.enemyBuffs.length>0)){lines.push({h:4*S});lines.push({text:'敌方状态：',color:'#C0392B',bold:true,size:11,h:smallLineH})};lines.push({text:`· 破防（防御 ${e.baseDef} → 0）`,color:'#C0392B',size:9,h:smallLineH-2*S})}
  if(g.heroBuffs&&g.heroBuffs.length>0){lines.push({h:4*S});lines.push({text:'己方状态：',color:'#2E6DA4',bold:true,size:11,h:smallLineH});g.heroBuffs.forEach(b=>{const dur=b.dur<99?` (${b.dur}回合)`:'';lines.push({text:`· ${b.name||b.type}${dur}`,color:b.bad?'#C0392B':'#27864A',size:9,h:smallLineH-2*S})})}
  let totalH=padY*2+18*S;lines.forEach(l=>{totalH+=(l.h||0)});if(totalH>H*0.8) totalH=H*0.8
  const tipX=(W-tipW)/2,tipY=(H-totalH)/2
  sc.addChild(PR.createInfoPanel(tipX,tipY,tipW,totalH))
  let curY=tipY+padY
  for(const l of lines){
    if(!l.text){curY+=(l.h||0);continue}
    curY+=l.h;if(curY>tipY+totalH-18*S) break
    if(l.attrOrb){const orbR=5*S;const bead=PR.createBeadSprite(l.attrOrb,orbR*2);bead.position.set(tipX+padX+orbR,curY-4*S);sc.addChild(bead);sc.addChild(Object.assign(PR.createText(l.text,{fontSize:l.size*S,fill:l.color,anchor:{x:0,y:0.5}}),{position:new PIXI.Point(tipX+padX+orbR*2+4*S,curY-4*S)}))}
    else if(l.tagColor){sc.addChild(Object.assign(PR.createText(l.text,{fontSize:l.size*S,fill:l.tagColor||l.color,fontWeight:l.bold?'bold':'normal',anchor:{x:0,y:0.5}}),{position:new PIXI.Point(tipX+padX,curY-4*S)}))}
    else{sc.addChild(Object.assign(PR.createText(l.text,{fontSize:l.size*S,fill:l.color||'#3D2B1F',fontWeight:l.bold?'bold':'normal',anchor:{x:0,y:0.5}}),{position:new PIXI.Point(tipX+padX,curY-4*S)}))}
  }
  sc.addChild(Object.assign(PR.createText('点击任意位置关闭',{fontSize:9*S,fill:'#9B8B80',anchor:0.5}),{position:new PIXI.Point(W*0.5,tipY+totalH-6*S)}))
}

/* ===== 法宝详情弹窗 ===== */
function _weaponDetailDialog(sc,g){
  if(!g.weapon){g.showWeaponDetail=false;return}
  const w=g.weapon,padX=16*S,padY=14*S,lineH=18*S,smallLineH=15*S,tipW=W*0.84
  sc.addChild(PR.createOverlay(0,0.45))
  let lines=[]
  lines.push({text:w.name,color:'#8B6914',bold:true,size:14,h:lineH+2*S,wpnPrefix:true})
  lines.push({h:4*S});lines.push({text:'法宝效果：',color:'#8B6914',bold:true,size:11,h:smallLineH})
  _wrapDialog(w.desc||'无',tipW-padX*2-8*S,10).forEach(dl=>{lines.push({text:dl,color:'#3D2B1F',size:10,h:smallLineH})})
  lines.push({h:4*S});lines.push({text:'提示：法宝为被动效果，全程自动生效',color:'#8B7B70',size:9,h:smallLineH})
  let totalH=padY*2+18*S;lines.forEach(l=>{totalH+=(l.h||0)})
  // 法宝图片预留空间
  const imgSz=56*S;totalH+=imgSz+6*S
  const tipX=(W-tipW)/2,tipY=(H-totalH)/2
  sc.addChild(PR.createInfoPanel(tipX,tipY,tipW,totalH))
  // 法宝图片
  const wImg=PR.createSprite(`assets/equipment/fabao_${w.id}.png`);wImg.width=imgSz;wImg.height=imgSz;wImg.position.set(tipX+(tipW-imgSz)/2,tipY+padY);sc.addChild(wImg)
  let curY=tipY+padY+imgSz+6*S
  for(const l of lines){
    if(!l.text){curY+=(l.h||0);continue}
    curY+=l.h
    let tx=tipX+padX,prefix=''
    if(l.wpnPrefix) prefix='法宝·'
    if(prefix){sc.addChild(Object.assign(PR.createText(prefix,{fontSize:l.size*S,fill:'#e0a020',fontWeight:'bold',anchor:{x:0,y:0.5}}),{position:new PIXI.Point(tx,curY-4*S)}));tx+=prefix.length*l.size*S}
    sc.addChild(Object.assign(PR.createText(l.text,{fontSize:l.size*S,fill:l.color||'#3D2B1F',fontWeight:l.bold?'bold':'normal',anchor:{x:0,y:0.5}}),{position:new PIXI.Point(tx,curY-4*S)}))
  }
  sc.addChild(Object.assign(PR.createText('点击任意位置关闭',{fontSize:9*S,fill:'#9B8B80',anchor:0.5}),{position:new PIXI.Point(W*0.5,tipY+totalH-6*S)}))
}

/* ===== 宠物详情弹窗 ===== */
function _petDetailDialog(sc,g,AC,getPetStarAtk,getPetSkillDesc,petHasSkill){
  const idx=g.showBattlePetDetail;if(idx==null||idx>=g.pets.length){g.showBattlePetDetail=null;return}
  const p=g.pets[idx],ac=AC[p.attr],sk=p.skill,padX=16*S,padY=14*S,lineH=22*S,smallLineH=18*S,tipW=W*0.84
  const {MAX_STAR}=require('../data/pets')
  sc.addChild(PR.createOverlay(0,0.45))
  let lines=[]
  const starText='★'.repeat(p.star||1)+(p.star<MAX_STAR?'☆'.repeat(MAX_STAR-(p.star||1)):'')
  lines.push({text:p.name,color:'#3D2B1F',bold:true,size:16,h:lineH+2*S,starSuffix:starText})
  const starAtk=getPetStarAtk(p),atkDisplay=(p.star||1)>1?`${p.atk}→${starAtk}`:`${p.atk}`
  lines.push({text:`ATK：${atkDisplay}`,color:'#6B5B50',size:12,h:smallLineH,attrOrb:p.attr})
  lines.push({h:4*S})
  if(sk&&petHasSkill(p)){
    lines.push({text:`技能：${sk.name}`,color:'#B8860B',bold:true,size:14,h:lineH})
    _wrapDialog(getPetSkillDesc(p)||'无描述',tipW-padX*2-8*S,12).forEach(dl=>{lines.push({text:dl,color:'#2A1F10',bold:true,size:12,h:smallLineH})})
    lines.push({h:3*S})
    let cdBase=p.cd,cdActual=cdBase;if(g.runBuffs&&g.runBuffs.skillCdReducePct>0){cdActual=Math.max(1,Math.round(cdBase*(1-g.runBuffs.skillCdReducePct/100)))}
    const cdReduced=cdActual<cdBase,cdText=cdReduced?`冷却：${cdActual}回合（原${cdBase}，CD缩短${g.runBuffs.skillCdReducePct}%）`:`冷却：${cdBase}回合`
    lines.push({text:cdText,color:'#6B5B50',size:11,h:smallLineH})
    if(p.currentCd<=0) lines.push({text:'✦ 技能已就绪，上划头像发动技能！',color:'#27864A',bold:true,size:12,h:smallLineH})
    else lines.push({text:`◈ 冷却中：还需 ${p.currentCd} 回合`,color:'#C07000',size:12,h:smallLineH})
  } else if(sk&&!petHasSkill(p)){
    lines.push({text:'技能：未解锁（升至★2解锁）',color:'#8B7B70',bold:true,size:13,h:lineH})
  } else {
    lines.push({text:'该宠物没有主动技能',color:'#8B7B70',size:12,h:smallLineH})
  }
  lines.push({h:4*S});lines.push({text:'提示：消除对应属性珠时该宠物发动攻击',color:'#8B7B70',size:11,h:smallLineH})
  let totalH=padY*2+18*S;lines.forEach(l=>{totalH+=(l.h||0)});if(totalH>H*0.8) totalH=H*0.8
  const tipX=(W-tipW)/2,tipY=(H-totalH)/2
  sc.addChild(PR.createInfoPanel(tipX,tipY,tipW,totalH))
  let curY=tipY+padY
  for(const l of lines){
    if(!l.text){curY+=(l.h||0);continue}
    curY+=l.h;if(curY>tipY+totalH-18*S) break
    if(l.attrOrb){const orbR=5*S;const bead=PR.createBeadSprite(l.attrOrb,orbR*2);bead.position.set(tipX+padX+orbR,curY-4*S);sc.addChild(bead);sc.addChild(Object.assign(PR.createText(l.text,{fontSize:l.size*S,fill:l.color,anchor:{x:0,y:0.5}}),{position:new PIXI.Point(tipX+padX+orbR*2+4*S,curY-4*S)}))}
    else{
      sc.addChild(Object.assign(PR.createText(l.text,{fontSize:l.size*S,fill:l.color||'#3D2B1F',fontWeight:l.bold?'bold':'normal',anchor:{x:0,y:0.5}}),{position:new PIXI.Point(tipX+padX,curY-4*S)}))
      if(l.starSuffix){sc.addChild(Object.assign(PR.createText(l.starSuffix,{fontSize:10*S,fill:'#C89510',fontWeight:'bold',anchor:{x:0,y:0.5}}),{position:new PIXI.Point(tipX+padX+l.text.length*l.size*S*0.6+4*S,curY-4*S)}))}
    }
  }
  sc.addChild(Object.assign(PR.createText('点击任意位置关闭',{fontSize:10*S,fill:'#9B8B80',anchor:0.5}),{position:new PIXI.Point(W*0.5,tipY+totalH-6*S)}))
}

/* 文本换行辅助 */
function _wrapDialog(text,maxW,fontSize){
  if(!text) return ['']
  const fullW=fontSize*S,halfW=fontSize*S*0.55,result=[];let line='',lineW=0
  for(let i=0;i<text.length;i++){const ch=text[i],cw=ch.charCodeAt(0)>127?fullW:halfW;if(lineW+cw>maxW&&line.length>0){result.push(line);line=ch;lineW=cw}else{line+=ch;lineW+=cw}}
  if(line) result.push(line);return result.length>0?result:['']
}

module.exports = { createBattleBuilder }
