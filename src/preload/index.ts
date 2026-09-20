import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { PopupData, PopupVisibilityState, TtsLanguage, TtsState } from '../shared/types'

/**
 * 沙箱渲染进程访问主进程的唯一桥接层（原计划 Phase 17 安全要求）：
 * contextIsolation + sandbox，通道白名单化，不暴露原始 ipcRenderer。
 */

/** 订阅主进程事件；返回取消订阅函数，React 组件卸载时清理。 */
function on<T = unknown>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => cb(args[0] as T)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('ht', {
  popup: {
    getData: () => ipcRenderer.invoke('popup:get-data'),
    onData: (cb: (data: PopupData) => void) => on<PopupData>('popup:data', cb),
    setPinned: (pinned: boolean) => ipcRenderer.send('popup:set-pinned', pinned),
    setSettingsOpen: (open: boolean) => ipcRenderer.send('popup:set-settings-open', open),
    onSettingsOpen: (cb: (open: boolean) => void) => on<boolean>('popup:settings-panel', cb),
    dragStart: (screenX: number, screenY: number) => ipcRenderer.send('popup:drag-start', screenX, screenY),
    dragMove: (screenX: number, screenY: number) => ipcRenderer.send('popup:drag-move', screenX, screenY),
    dragEnd: () => ipcRenderer.send('popup:drag-end'),
    resizeStart: (screenX: number, screenY: number) => ipcRenderer.send('popup:resize-start', screenX, screenY),
    resizeMove: (screenX: number, screenY: number) => ipcRenderer.send('popup:resize-move', screenX, screenY),
    resizeEnd: () => ipcRenderer.send('popup:resize-end'),
    resizeToContent: (height: number) => ipcRenderer.send('popup:resize-to-content', height),
    speak: (text: string, language: TtsLanguage) => ipcRenderer.send('popup:speak', { text, language }),
    stopSpeaking: () => ipcRenderer.send('popup:stop-speaking'),
    onTtsState: (cb: (state: TtsState) => void) => on<TtsState>('popup:tts-state', cb),
    onVisibility: (cb: (state: PopupVisibilityState) => void) => on<PopupVisibilityState>('popup:visibility', cb),
    mouseEnter: () => ipcRenderer.send('popup:mouse-enter'),
    mouseLeave: () => ipcRenderer.send('popup:mouse-leave'),
    translateAnyway: (id: number) => ipcRenderer.send('popup:translate-anyway', id),
    translateInput: (text: string) => ipcRenderer.send('popup:translate-input', text),
    copy: (text: string) => ipcRenderer.send('popup:copy', text),
    close: () => ipcRenderer.send('popup:close')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
    previewAppearance: (patch: Record<string, unknown>) => ipcRenderer.send('settings:preview-appearance', patch),
    minimize: () => ipcRenderer.send('settings:minimize'),
    toggleMaximize: () => ipcRenderer.send('settings:toggle-maximize'),
    getWindowState: () => ipcRenderer.invoke('settings:window-state'),
    onWindowState: (cb: (state: { maximized: boolean; minimized: boolean }) => void) =>
      on<{ maximized: boolean; minimized: boolean }>('settings:window-state', cb),
    quitApp: () => ipcRenderer.send('app:quit'),
    openPopupTest: () => ipcRenderer.send('app:open-popup-test'),
    openSettings: () => ipcRenderer.send('app:open-settings')
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    remove: (id: number) => ipcRenderer.invoke('history:delete', id),
    clear: () => ipcRenderer.invoke('history:clear')
  },
  models: {
    status: () => ipcRenderer.invoke('models:status'),
    setup: () => ipcRenderer.invoke('models:setup'),
    download: (key: string) => ipcRenderer.invoke('models:download', key),
    serviceStatus: () => ipcRenderer.invoke('service:status'),
    onChanged: (cb: (payload: unknown) => void) => on('models:changed', cb)
  },
  appearance: {
    pickImage: (purpose: string) => ipcRenderer.invoke('appearance:pick-image', purpose),
    resetImage: (purpose: string) => ipcRenderer.invoke('appearance:reset-image', purpose)
  }
})
