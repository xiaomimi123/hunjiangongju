// 把整段文案按「句末标点 + 换行」切成分镜（每个分镜=一句=一图一配音）。
// 句内逗号不切——句内节奏由下游 splitCaptionPhrases 按逗号切成字幕节拍。纯函数。
export function splitScriptToSegments(text: string): string[] {
  return String(text ?? '')
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
