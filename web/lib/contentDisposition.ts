// 生成安全的 Content-Disposition: attachment 头。ASCII 名放 filename，非 ASCII 走 filename*（RFC 5987）。
export function contentDispositionAttachment(filename: string): string {
  const clean = String(filename ?? 'download').replace(/[\r\n"]/g, '').trim() || 'download'
  const ascii = clean.replace(/[^\x20-\x7E]/g, '_') // 非 ASCII 回退占位
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`
}
