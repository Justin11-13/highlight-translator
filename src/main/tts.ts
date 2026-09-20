import { spawn, type ChildProcess } from 'node:child_process'
import { log } from './logger'
import type { TtsLanguage, TtsState } from '@shared/types'

let currentProcess: ChildProcess | null = null
let currentLanguage: TtsLanguage | undefined
const listeners = new Set<(state: TtsState) => void>()

const POWERSHELL_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $cultureName = if ([string]$payload.language -eq 'zh') { 'zh-CN' } else { 'en-US' }
  $voice = $synth.GetInstalledVoices() |
    Where-Object { $_.VoiceInfo.Culture.Name -like ($cultureName + '*') } |
    Select-Object -First 1
  if (-not $voice) {
    throw "No installed Windows speech voice for $cultureName"
  }
  $synth.SelectVoice($voice.VoiceInfo.Name)
  $synth.Speak([string]$payload.text)
} finally {
  $synth.Dispose()
}
`

function powershellPath(): string {
  return `${process.env['WINDIR'] ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
}

function encodedCommand(): string {
  return Buffer.from(POWERSHELL_SCRIPT, 'utf16le').toString('base64')
}

function notify(state: TtsState): void {
  for (const listener of listeners) {
    listener(state)
  }
}

function finish(process: ChildProcess): void {
  if (currentProcess !== process) {
    return
  }

  currentProcess = null
  const language = currentLanguage
  currentLanguage = undefined
  notify({ speaking: false, language })
}

/** 使用 Windows System.Speech 异步朗读，不阻塞 Electron 主进程。 */
export function speakText(text: string, language: TtsLanguage): void {
  const normalized = text.trim()

  if (!normalized) {
    return
  }

  stopSpeaking()

  let child: ChildProcess

  try {
    child = spawn(
      powershellPath(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encodedCommand()
      ],
      { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true }
    )
  } catch (error) {
    log('tts spawn failed:', error as Error)
    return
  }

  currentProcess = child
  currentLanguage = language

  child.stderr?.on('data', (chunk: Buffer) => {
    const message = chunk.toString().trim()
    if (message) {
      log('tts stderr:', message)
    }
  })

  child.once('error', (error) => {
    log('tts process failed:', error)
    finish(child)
  })

  child.once('exit', () => finish(child))

  try {
    child.stdin?.end(JSON.stringify({ text: normalized, language }), 'utf8')
  } catch (error) {
    log('tts input failed:', error as Error)
    finish(child)
    return
  }

  notify({ speaking: true, language })
}

export function stopSpeaking(): void {
  if (!currentProcess) {
    return
  }

  const child = currentProcess
  currentProcess = null
  const language = currentLanguage
  currentLanguage = undefined

  try {
    child.kill()
  } catch (error) {
    log('tts stop failed:', error as Error)
  }

  notify({ speaking: false, language })
}

export function stopTts(): void {
  stopSpeaking()
}

export function onTtsState(listener: (state: TtsState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
