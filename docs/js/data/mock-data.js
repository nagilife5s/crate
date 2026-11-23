// モック用のダミーデータ。曲名・アーティストは架空。音は media/ の合成音（著作権なし）。
export const SCHEMA_VERSION = 1;

const DUR = { 'tone-a.mp3': 20, 'tone-b.mp3': 30, 'tone-c.mp3': 45, 'tone-d.mp3': 75 };
const own = (n, title, artist, file) => ({ id: 't' + n, kind: 'file', ref: file, title, artist, duration: DUR[file] });
const yt = (id, videoId, title, artist) => ({ id, kind: 'youtube', ref: videoId, title, artist, duration: null });

const TRACKS = [
  own(1, '夜明けのプラットフォーム', '港町レコード', 'tone-a.mp3'),
  own(2, 'Coffee & Rain', 'Mellow Crate', 'tone-b.mp3'),
  own(3, '放課後のテーマ', '港町レコード', 'tone-a.mp3'),
  own(4, 'Slow Drive', 'Night Shift', 'tone-c.mp3'),
  own(5, 'とても長い曲名のテスト――海沿いの道をどこまでも走っていくときに聴きたい、少し切なくて明るい曲（Extended Mix）', '長いアーティスト名のテスト・オーケストラ・アンド・フレンズ', 'tone-d.mp3'),
  own(6, 'Blue Hour', 'Mellow Crate', 'tone-b.mp3'),
  own(7, 'ひだまり', '柚子の木', 'tone-c.mp3'),
  own(8, 'Midnight Library', 'Night Shift', 'tone-d.mp3'),
  own(9, '雨上がりのバス停', '柚子の木', 'tone-a.mp3'),
  own(10, 'Lo-fi Study 01', 'Desk Beats', 'tone-b.mp3'),
  own(11, 'Lo-fi Study 02', 'Desk Beats', 'tone-c.mp3'),
  own(12, '帰り道', '港町レコード', 'tone-b.mp3'),
  own(13, 'Neon Garden', 'Night Shift', 'tone-d.mp3'),
  own(14, '朝ごはんのうた', '柚子の木', 'tone-a.mp3'),
  own(15, 'Last Train', 'Mellow Crate', 'tone-c.mp3'),
  yt('y-zoo', 'jNQXAC9IVRw', 'Me at the zoo', 'jawed'),
  yt('y-bbb', 'aqz-KE-bpKQ', 'Big Buck Bunny 60fps 4K', 'Blender'),
  yt('y-rick', 'dQw4w9WgXcQ', 'Never Gonna Give You Up', 'Rick Astley'),
  yt('y-sintel', 'eRsGyueVLvQ', 'Sintel', 'Blender'),
  yt('y-bad', 'zzzzzzzzzzz', '（再生できない動画のテスト）', 'テスト'),
];

const PLAYLISTS = [
  { id: 'pl-mix', name: '混在テスト（短い曲）', trackIds: ['t1', 'y-zoo', 't3', 'y-bad', 't9'] },
  { id: 'pl-commute', name: '通勤ミックス', trackIds: ['t2', 'y-zoo', 't4', 't6', 'y-rick', 't12'] },
  { id: 'pl-night', name: '夜に聴く', trackIds: ['t4', 't8', 't13', 't15', 't6'] },
  { id: 'pl-empty', name: '空のリスト', trackIds: [] },
];

export function seedLibrary() {
  return JSON.parse(JSON.stringify({ schemaVersion: SCHEMA_VERSION, tracks: TRACKS, playlists: PLAYLISTS }));
}

/** モックで「タイトル自動取得」が成功する動画（本番は Worker が YouTube oEmbed を引く） */
export const YT_META = {
  jNQXAC9IVRw: { title: 'Me at the zoo', author: 'jawed' },
  'aqz-KE-bpKQ': { title: 'Big Buck Bunny 60fps 4K', author: 'Blender' },
  dQw4w9WgXcQ: { title: 'Rick Astley - Never Gonna Give You Up (Official Video)', author: 'Rick Astley' },
  eRsGyueVLvQ: { title: 'Sintel - Open Movie by Blender Foundation', author: 'Blender' },
  'M7lc1UVf-VE': { title: 'YouTube Developers Live: Embedded Web Player Customization', author: 'Google for Developers' },
};
