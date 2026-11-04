import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weightsToPercents, percentsToWeights } from '../lib/compose.js'

test('权重 8:1:1 → 80% / 10% / 10%（这就是主人看不懂的地方）', () => {
  const p = weightsToPercents({ text: 8, voice: 1, sticker: 1 })
  assert.deepEqual(p, { text: 80, voice: 10, sticker: 10 })
})

test('百分比三个数加起来永远是 100', () => {
  const cases = [
    { text: 1, voice: 1, sticker: 1 },
    { text: 7, voice: 2, sticker: 1 },
    { text: 3, voice: 3, sticker: 1 },   // 除不尽的情况
    { text: 1, voice: 2, sticker: 4 },
    { text: 20, voice: 1, sticker: 1 },
  ]
  for (const w of cases) {
    const p = weightsToPercents(w)
    assert.equal(p.text + p.voice + p.sticker, 100, `${JSON.stringify(w)} → ${JSON.stringify(p)}`)
  }
})

test('全 0 → 100% 文字（和 decideFormat 的兜底一致）', () => {
  assert.deepEqual(weightsToPercents({ text: 0, voice: 0, sticker: 0 }), { text: 100, voice: 0, sticker: 0 })
  assert.deepEqual(weightsToPercents({}), { text: 100, voice: 0, sticker: 0 })
})

test('只有语音 → 100% 语音', () => {
  assert.deepEqual(weightsToPercents({ text: 0, voice: 5, sticker: 0 }), { text: 0, voice: 100, sticker: 0 })
})

test('负数按 0 处理（脏配置别把界面算崩）', () => {
  const p = weightsToPercents({ text: -5, voice: 1, sticker: 1 })
  assert.deepEqual(p, { text: 0, voice: 50, sticker: 50 })
})

test('百分比 → 权重：比例保持不变', () => {
  const w = percentsToWeights({ text: 80, voice: 10, sticker: 10 })
  assert.deepEqual(w, { text: 80, voice: 10, sticker: 10 })
  // 再转回百分比，还是原来那样
  assert.deepEqual(weightsToPercents(w), { text: 80, voice: 10, sticker: 10 })
})

test('百分比 → 权重：全 0 兜底成 100 文字', () => {
  assert.deepEqual(percentsToWeights({ text: 0, voice: 0, sticker: 0 }), { text: 100, voice: 0, sticker: 0 })
})

test('进出一趟不失真（老配置 8:1:1 改一次再存回来还是 80/10/10）', () => {
  const back = percentsToWeights(weightsToPercents({ text: 8, voice: 1, sticker: 1 }))
  assert.deepEqual(weightsToPercents(back), { text: 80, voice: 10, sticker: 10 })
})

test('超范围的值被夹住', () => {
  assert.deepEqual(percentsToWeights({ text: 200, voice: -10, sticker: 0 }), { text: 100, voice: 0, sticker: 0 })
})
