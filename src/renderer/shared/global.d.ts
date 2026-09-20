/** 声明 preload 暴露的 window.ht 类型（渲染层唯一的非标准全局）。 */

import type { HtBridge } from '../../shared/types'

declare global {
  interface Window {
    ht?: HtBridge
  }
}

export {}
