// 剪映 draft_content.json 明文头部判定：剥掉 UTF-8 BOM 与前导空白后是否以 { 开头。
// 新版剪映(约 6.5+，含 iOS 19.x)默认加密 draft_content.json，密文不以 { 开头——用这个判定
// 区分"看起来像明文 JSON"与"看起来是加密内容"。多处调用方共用同一判定，避免各自实现走样：
// - web/app/admin/jianying/page.tsx：选文件夹回退明文时间线 / 单文件上传 / 粘贴文本，三个入口
// - web/app/api/admin/jianying/parse/route.ts：服务端兜底判断 400 该报"格式错误"还是"疑似加密"
export function looksLikePlainJsonHead(head: string): boolean {
  const BOM = String.fromCharCode(0xfeff)
  const stripped = head.startsWith(BOM) ? head.slice(1) : head
  return stripped.trimStart().startsWith('{')
}
