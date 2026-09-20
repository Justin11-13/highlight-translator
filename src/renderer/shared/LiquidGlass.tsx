import { type CSSProperties, type ReactNode } from 'react'

export interface LiquidGlassProps {
  radius?: number
  /** 卡片基础着色透明度 0..1（暗色玻璃） */
  tintAlpha?: number
  /** 玻璃着色基色（hex），默认深蓝黑 */
  tintColor?: string
  dark?: boolean
  /** 背景模糊像素 */
  blur?: number
  /** 可选背景照片（htimg:// URL），被玻璃覆盖 */
  backdropImage?: string | null
  className?: string
  style?: CSSProperties
  children: ReactNode
}

/**
 * 液态玻璃卡片（与用户 Chrome 扩展同款视觉方案）：
 *
 *   卡片（着色 + 阴影 + 圆角）
 *    ├─ glass-backdrop-img : 可选背景照片
 *    ├─ glass-filter-layer : backdrop blur + saturate（模糊背后内容）
 *    ├─ glass-aurora       : 玻璃质感渐变
 *    ├─ 静态边框                : 保持圆角轮廓，不添加顶部高光
 *    └─ 内容               : 永远清晰
 *
 * 注意：故意不使用 backdrop-filter: url(#SVG位移滤镜) —— 实测该写法会把
 * 元素自身内容一起模糊（Chromium 合成限制）。扩展的主弹窗同样只用 blur。
 */
export function LiquidGlass({
  radius = 20,
  tintAlpha = 0.68,
  tintColor,
  dark = true,
  blur = 8,
  backdropImage,
  className = '',
  style,
  children
}: LiquidGlassProps) {
  const tintRgb = hexToRgbTriplet(tintColor)
  const baseTint = dark ? `rgba(${tintRgb}, ${tintAlpha})` : `rgba(255, 255, 255, ${tintAlpha})`
  const normalizedBlur = Math.max(0, blur)
  const blurProgress = Math.min(1, Math.max(0, (normalizedBlur - 8) / 22))

  return (
    <div
      className={`liquid-glass-card ${className}`}
      style={{
        ['--ht-glass-blur' as string]: `${normalizedBlur}px`,
        ['--ht-glass-blur-scale' as string]: 1 + normalizedBlur / 300,
        ['--ht-glass-blur-progress' as string]: blurProgress,
        borderRadius: radius,
        background: baseTint,
        backdropFilter: `blur(${normalizedBlur}px) saturate(1.2)`,
        WebkitBackdropFilter: `blur(${normalizedBlur}px) saturate(1.2)`,
        ...style
      }}
    >
      {backdropImage && (
        <div
          className="glass-backdrop-img"
          style={{
            backgroundImage: `url("${backdropImage}")`,
            // 背景照片是卡片自身的子层，不会被外层 backdrop-filter 处理；这里同步应用 Blur。
            filter: `blur(${normalizedBlur}px) saturate(1.12)`,
            transform: 'scale(1.06)'
          }}
        />
      )}

      <div className="glass-aurora" />
      <div
        className="glass-filter-layer"
        style={{
          // Blur 只存在于独立背景层；文字与控件位于 z-index:2，始终清晰。
          backdropFilter: `blur(${normalizedBlur}px)`,
          WebkitBackdropFilter: `blur(${normalizedBlur}px)`
        }}
      />
      {children}
    </div>
  )
}

/** hex (#rrggbb) -> "r, g, b"，用于拼 rgba()；非法输入回退深蓝黑。 */
function hexToRgbTriplet(hex: string | undefined): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')

  if (!match) {
    return '16, 18, 28'
  }

  const int = parseInt(match[1], 16)
  return `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}`
}
