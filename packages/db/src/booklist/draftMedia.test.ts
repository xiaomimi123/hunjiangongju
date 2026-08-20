import { describe, it, expect } from 'vitest'
import { extractDraftMedia, readFrameworkDefaults, pickBgmSegment } from './draftMedia'

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
  tracks: [
    { type: 'audio', segments: [{ material_id: 'a1', volume: 0.65, target_timerange: { start: 0, duration: 20000000 } }] }, // BGM,被压低音量
    { type: 'audio', segments: [{ material_id: 'a3', target_timerange: { start: 0, duration: 19790000 } }] }, // 配音参考轨,无 volume,排除
    { type: 'audio', segments: [{ material_id: 'a4', volume: 0.4, target_timerange: { start: 0, duration: 500000 } }] }, // 音效轨(type=sound),排除
  ],
}

describe('extractDraftMedia', () => {
  it('BGM=「歌曲」非「提取」轨,按文件名去重;图片=photo 素材白名单扩展去重', () => {
    expect(extractDraftMedia(draft)).toEqual({
      bgm: [{ fileName: '9DF714A2.mp3', title: '歌曲20260702-02' }],
      images: ['IMG_A.png', 'IMG_B.jpg'],
      // 这份 fixture 没有主视频轨,切不出快闪角色 → 全部当正片图
      coverImages: [],
    })
  })
  it('非对象/缺 materials → 空清单', () => {
    expect(extractDraftMedia(null)).toEqual({ bgm: [], images: [], coverImages: [] })
    expect(extractDraftMedia({})).toEqual({ bgm: [], images: [], coverImages: [] })
    expect(extractDraftMedia({ materials: { audios: 'x', videos: 42 } })).toEqual({ bgm: [], images: [], coverImages: [] })
  })
})

const P2 = '##_draftpath_placeholder_X_##'
// 新模板口径：BGM 是被压低音量(<1)且覆盖最长的非音效轨；人声音量 3.94 被排除
const newStyle = {
  duration: 33_500_000,
  materials: {
    audios: [
      { id: 'a1', name: '一滴水滴声', path: `${P2}/audio/drop.mp3`, type: 'sound' },
      { id: 'a2', name: '7.6.wav', path: `${P2}/audio/7.6.wav`, type: 'extract_music' },
      { id: 'a3', name: '怎么说我不爱你（DJ前奏版）', path: `${P2}/audio/song.mp3`, type: 'music' },
    ],
  },
  tracks: [
    { type: 'audio', segments: [{ material_id: 'a1', volume: 2.75, target_timerange: { start: 0, duration: 1_633_000 } }] },
    { type: 'audio', segments: [{ material_id: 'a2', volume: 3.94, target_timerange: { start: 0, duration: 23_900_000 } }] },
    { type: 'audio', segments: [{ material_id: 'a3', volume: 0.4425, target_timerange: { start: 0, duration: 33_500_000 } }] },
  ],
}
// 旧样例口径：BGM 音量 0.692 分两段共 25s；人声轨无 volume 字段被排除
const oldStyle = {
  duration: 24_602_000,
  materials: {
    audios: [
      { id: 'b1', name: '歌曲20260702-02', path: `${P2}/audio/song.mp3`, type: 'extract_music' },
      { id: 'b2', name: '提取音乐20260702-02', path: `${P2}/audio/voice.mov`, type: 'extract_music' },
    ],
  },
  tracks: [
    { type: 'audio', segments: [
      { material_id: 'b1', volume: 0.692, target_timerange: { start: 0, duration: 20_140_000 } },
      { material_id: 'b1', volume: 0.692, target_timerange: { start: 20_140_000, duration: 5_134_000 } },
    ] },
    { type: 'audio', segments: [{ material_id: 'b2', target_timerange: { start: 0, duration: 19_790_000 } }] },
  ],
}

describe('pickBgmSegment（音量<1 且覆盖最长的非音效轨）', () => {
  it('新模板：选中 music 轨,排除人声(vol 3.94)与音效', () => {
    expect(pickBgmSegment(newStyle)).toEqual({ materialId: 'a3', name: '怎么说我不爱你（DJ前奏版）', volume: 0.4425, fileName: 'song.mp3' })
  })
  it('旧样例：选中「歌曲」轨(多段合计),排除无音量的人声轨', () => {
    expect(pickBgmSegment(oldStyle)).toEqual({ materialId: 'b1', name: '歌曲20260702-02', volume: 0.692, fileName: 'song.mp3' })
  })
  it('无合格候选 → null', () => {
    expect(pickBgmSegment({ materials: { audios: [{ id: 'x', name: '齿轮', type: 'sound', path: `${P2}/audio/g.mp3` }] }, tracks: [{ type: 'audio', segments: [{ material_id: 'x', volume: 0.5, target_timerange: { duration: 1000 } }] }] })).toBeNull()
    expect(pickBgmSegment(null)).toBeNull()
  })
})

describe('extractDraftMedia 用新判据取 BGM', () => {
  it('新模板：拿到 song.mp3 + 曲名', () => {
    expect(extractDraftMedia(newStyle).bgm).toEqual([{ fileName: 'song.mp3', title: '怎么说我不爱你（DJ前奏版）' }])
  })
  it('旧样例：仍拿到歌曲轨(向后兼容)', () => {
    expect(extractDraftMedia(oldStyle).bgm).toEqual([{ fileName: 'song.mp3', title: '歌曲20260702-02' }])
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

// ★ 书封必须和正片配图分开。混在同一个素材库文件夹里，正片槽位会随机抽到书封当配图
// ——客户样例实测 13 张图里 9 张是书封，成片 3 张正片图有 2 张是书封。
describe('extractDraftMedia —— 书封与正片配图分开', () => {
  // 主视频轨：第 0 段=开场，随后连续的短段(<500ms)=快闪书封，其余=正片
  const withRoles = {
    materials: {
      videos: [
        { id: 'o1', type: 'photo', path: `${P}/video/OPEN.png` },
        { id: 'c1', type: 'photo', path: `${P}/video/COVER_1.png` },
        { id: 'c2', type: 'photo', path: `${P}/video/COVER_2.png` },
        { id: 'c3', type: 'photo', path: `${P}/video/COVER_3.png` },
        { id: 'b1', type: 'photo', path: `${P}/video/BODY_1.png` },
        { id: 'b2', type: 'photo', path: `${P}/video/BODY_2.png` },
      ],
    },
    tracks: [
      {
        type: 'video',
        attribute: 1,
        segments: [
          { material_id: 'o1', target_timerange: { start: 0, duration: 2159000 } },
          { material_id: 'c1', target_timerange: { start: 2159000, duration: 200000 } },
          { material_id: 'c2', target_timerange: { start: 2359000, duration: 190000 } },
          { material_id: 'c3', target_timerange: { start: 2549000, duration: 210000 } },
          { material_id: 'b1', target_timerange: { start: 2759000, duration: 5703000 } },
          { material_id: 'b2', target_timerange: { start: 8462000, duration: 6067000 } },
        ],
      },
    ],
  }

  it('快闪段的图被认成书封，开场与正片的图不在其中', () => {
    const m = extractDraftMedia(withRoles)
    expect(m.coverImages.sort()).toEqual(['COVER_1.png', 'COVER_2.png', 'COVER_3.png'])
    expect(m.images).toContain('OPEN.png')
    expect(m.images).toContain('BODY_1.png')
    expect(m.coverImages).not.toContain('BODY_1.png')
    expect(m.coverImages).not.toContain('OPEN.png')
  })

  it('images 仍是全量（老调用方按它做校验，不能少给）', () => {
    const m = extractDraftMedia(withRoles)
    expect(m.images).toHaveLength(6)
  })

  // 切不出角色时退化成「全部当正片图」——与加这个字段之前的行为一致，不能因此炸掉导入
  it('没有主视频轨时不报错，书封清单为空', () => {
    const m = extractDraftMedia({ materials: withRoles.materials, tracks: [] })
    expect(m.coverImages).toEqual([])
    expect(m.images).toHaveLength(6)
  })
})
