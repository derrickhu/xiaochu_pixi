/**
 * PixiJS 资源管理器
 * 替代原 Render._imgCache 和 getImg()
 * 使用 PIXI.Assets 进行资源加载和缓存
 */
const PIXI = require('../libs/pixi-wrapper')

class AssetManager {
  constructor() {
    this._textureCache = {}  // path → PIXI.Texture
    this._loading = {}       // path → Promise
    this._failed = new Set() // 加载失败的路径
  }

  /**
   * 同步获取纹理（如果已缓存）
   * 未加载的会启动异步加载并返回 null
   * @param {string} path 
   * @returns {PIXI.Texture|null}
   */
  getTexture(path) {
    if (this._textureCache[path]) return this._textureCache[path]
    if (this._failed.has(path)) return null
    // 启动异步加载
    if (!this._loading[path]) {
      this._loadTexture(path)
    }
    return null
  }

  /**
   * 同步获取纹理，如果未加载返回白色占位纹理
   * @param {string} path
   * @returns {PIXI.Texture}
   */
  getTextureOrWhite(path) {
    return this.getTexture(path) || PIXI.Texture.WHITE
  }

  /**
   * 异步加载单个纹理
   * @param {string} path
   * @returns {Promise<PIXI.Texture>}
   */
  async _loadTexture(path) {
    if (this._textureCache[path]) return this._textureCache[path]
    if (this._loading[path]) return this._loading[path]

    this._loading[path] = new Promise((resolve) => {
      const img = wx.createImage()
      img.onload = () => {
        try {
          const resource = new PIXI.ImageResource(img)
          const baseTexture = new PIXI.BaseTexture(resource, {
            scaleMode: PIXI.SCALE_MODES.LINEAR,
          })
          const texture = new PIXI.Texture(baseTexture)
          this._textureCache[path] = texture
          resolve(texture)
        } catch (e) {
          console.warn('[AssetManager] 纹理创建失败:', path, e)
          this._failed.add(path)
          resolve(null)
        }
        delete this._loading[path]
      }
      img.onerror = (err) => {
        console.warn('[AssetManager] 图片加载失败:', path, err)
        this._failed.add(path)
        delete this._loading[path]
        resolve(null)
      }
      img.src = path
    })

    return this._loading[path]
  }

  /**
   * 批量预加载纹理
   * @param {string[]} paths - 图片路径数组
   * @param {function} [onProgress] - 进度回调 (loaded, total)
   * @returns {Promise<void>}
   */
  async preload(paths, onProgress) {
    let loaded = 0
    const total = paths.length
    if (total === 0) return

    const promises = paths.map(async (path) => {
      await this._loadTexture(path)
      loaded++
      if (onProgress) onProgress(loaded, total)
    })

    // 超时保底 5 秒
    await Promise.race([
      Promise.all(promises),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ])
  }

  /**
   * 从缓存中获取wx.createImage()创建的原始Image对象
   * 兼容原有代码中直接使用image对象的场景
   * @param {string} path
   * @returns {object|null}
   */
  getImage(path) {
    const tex = this._textureCache[path]
    if (tex && tex.baseTexture && tex.baseTexture.resource) {
      return tex.baseTexture.resource.source
    }
    return null
  }

  /**
   * 检查纹理是否已加载
   */
  has(path) {
    return !!this._textureCache[path]
  }

  /**
   * 清理所有缓存
   */
  destroy() {
    for (const key in this._textureCache) {
      this._textureCache[key].destroy(true)
    }
    this._textureCache = {}
    this._loading = {}
    this._failed.clear()
  }
}

// 单例
const assetManager = new AssetManager()
module.exports = assetManager
