import { describe, it, expect } from 'vitest'
import { extractDraftMedia, readFrameworkDefaults } from './draftMedia'

const P = '##_draftpath_placeholder_ABC_##'
const draft = {
  materials: {
    audios: [
      { id: 'a1', name: '歌曲20260702-02', path: `${P}/audio/9DF714A2.mp3`, type: 'extract_music' },
      { id: 'a2', name: '歌曲20260702-02', path: `${P}/audio/9DF714A2.mp3`, type: 'extract_music' }, // 同文件重复引用
      { id: 'a3', name: '提取音乐20260702-02', path: `${P}/audio/6D166269.mov`, type: 'extract_music' }, // 配音参考,排除
      { id: 'a4', name: '发条旋钮转动齿轮', path: `${P}/audio/7008917.mp3`, type: 'sound' }, // 音效,排除
    ],
    videos: [
      { id: 'v1', type: 'video', path: `${P}/video/REAL_SHOT.mov` }, // 实拍,排除
      { id: 'v2', type: 'photo', path: `${P}/video/IMG_A.png` },
      { id: 'v3', type: 'photo', path: `${P}/video/IMG_A.png` }, // 重复,去重
      { id: 'v4', type: 'photo', path: `${P}/video/IMG_B.jpg` },
      { id: 'v5', type: 'photo', path: `${P}/video/IMG_C.heic` }, // 不支持的扩展,排除
    ],
  },
}

describe('extractDraftMedia', () => {
  it('BGM=「歌曲」非「提取」轨,按文件名去重;图片=photo 素材白名单扩展去重', () => {
    expect(extractDraftMedia(draft)).toEqual({
      bgm: [{ fileName: '9DF714A2.mp3', title: '歌曲20260702-02' }],
      images: ['IMG_A.png', 'IMG_B.jpg'],
    })
  })
  it('非对象/缺 materials → 空清单', () => {
    expect(extractDraftMedia(null)).toEqual({ bgm: [], images: [] })
    expect(extractDraftMedia({})).toEqual({ bgm: [], images: [] })
    expect(extractDraftMedia({ materials: { audios: 'x', videos: 42 } })).toEqual({ bgm: [], images: [] })
  })
})

describe('readFrameworkDefaults', () => {
  it('读出 overlayTemplate 顶层 __defaultBgmId/__defaultAssetFolder', () => {
    expect(readFrameworkDefaults({ __defaultBgmId: 'b1', __defaultAssetFolder: '今天分享的是' }))
      .toEqual({ bgmId: 'b1', assetFolder: '今天分享的是' })
  })
  it('缺失/空串/非字符串/非对象 → null', () => {
    expect(readFrameworkDefaults({})).toEqual({ bgmId: null, assetFolder: null })
    expect(readFrameworkDefaults({ __defaultBgmId: '', __defaultAssetFolder: 42 })).toEqual({ bgmId: null, assetFolder: null })
    expect(readFrameworkDefaults(null)).toEqual({ bgmId: null, assetFolder: null })
  })
})
