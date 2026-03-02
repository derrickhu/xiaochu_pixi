/**
 * PixiJS 场景管理器
 * 每个场景是一个 PIXI.Container，场景切换时隐藏/显示对应容器
 * 
 * 场景列表（与原 Main.scene 字符串一致）:
 * loading, title, prepare, event, battle, reward, shop, rest, adventure, gameover, ranking, stats, dex
 */
const PIXI = require('../libs/pixi-wrapper')
const V = require('./ViewEnv')

const SCENE_NAMES = [
  'loading', 'title', 'prepare', 'event', 'battle',
  'reward', 'shop', 'rest', 'adventure',
  'gameover', 'ranking', 'stats', 'dex',
]

class SceneManager {
  constructor() {
    this._scenes = {}        // name → PIXI.Container
    this._current = null     // 当前场景名
    this._overlays = {}      // 覆盖层（弹窗、教学引导等）
    this._effectLayer = null // 全局特效层（飘字、技能特效等）
  }

  /**
   * 初始化所有场景容器
   */
  init() {
    const stage = V.stage

    // 创建各场景容器
    for (const name of SCENE_NAMES) {
      const container = new PIXI.Container()
      container.name = `scene_${name}`
      container.visible = false
      container.sortableChildren = true
      stage.addChild(container)
      this._scenes[name] = container
    }

    // 全局特效层（始终在最上面）
    this._effectLayer = new PIXI.Container()
    this._effectLayer.name = 'effectLayer'
    this._effectLayer.zIndex = 1000
    this._effectLayer.sortableChildren = true
    stage.addChild(this._effectLayer)

    // 覆盖层（弹窗、教学等）
    this._overlayContainer = new PIXI.Container()
    this._overlayContainer.name = 'overlays'
    this._overlayContainer.zIndex = 900
    this._overlayContainer.sortableChildren = true
    stage.addChild(this._overlayContainer)

    console.log('[SceneManager] 初始化完成，共', SCENE_NAMES.length, '个场景')
  }

  /**
   * 切换到指定场景
   * @param {string} name - 场景名
   */
  switchTo(name) {
    if (this._current === name) return
    if (this._current && this._scenes[this._current]) {
      this._scenes[this._current].visible = false
    }
    if (this._scenes[name]) {
      this._scenes[name].visible = true
      this._current = name
    } else {
      console.warn('[SceneManager] 未知场景:', name)
    }
  }

  /**
   * 获取场景容器
   * @param {string} name - 场景名
   * @returns {PIXI.Container}
   */
  getScene(name) {
    return this._scenes[name] || null
  }

  /**
   * 获取当前场景名
   */
  get current() {
    return this._current
  }

  /**
   * 获取全局特效层
   */
  get effectLayer() {
    return this._effectLayer
  }

  /**
   * 获取覆盖层容器
   */
  get overlayContainer() {
    return this._overlayContainer
  }

  /**
   * 清空指定场景的所有子节点（重建时用）
   */
  clearScene(name) {
    const scene = this._scenes[name]
    if (scene) {
      scene.removeChildren()
    }
  }

  /**
   * 清空全局特效层
   */
  clearEffects() {
    this._effectLayer.removeChildren()
  }

  /**
   * 清空覆盖层
   */
  clearOverlays() {
    this._overlayContainer.removeChildren()
  }
}

// 单例
const sceneManager = new SceneManager()
module.exports = sceneManager
