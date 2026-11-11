import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makePendingBatchingNotifier } from '../lib/index.js'

function tmpState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pend-batch-'))
  return path.join(dir, 'n.json')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('连发一串：攒够 20 秒静默才合成一条推出去', async () => {
  const sent = []
  const n = makePendingBatchingNotifier({
    stateFile: tmpState(), idleMs: 60, perDay: 30,
    onFlush: (t) => sent.push(t),
  })
  n.push({ whoId: 'u1', whoName: '阿达', text: '第一条' })
  await sleep(20)
  n.push({ whoId: 'u1', whoName: '阿达', text: '第二条' })
  await sleep(20)
  n.push({ whoId: 'u1', whoName: '阿达', text: '第三条' })
  assert.equal(sent.length, 0, '还没安静下来，不该推')
  await sleep(150)
  assert.equal(sent.length, 1, '安静之后只推一条汇总')
  assert.match(sent[0], /阿达 发了 3 条/)
  assert.match(sent[0], /第一条/)
  assert.match(sent[0], /第三条/)
})

test('两个人各自攒各自的，互不打断', async () => {
  const sent = []
  const n = makePendingBatchingNotifier({
    stateFile: tmpState(), idleMs: 60, perDay: 30,
    onFlush: (t) => sent.push(t),
  })
  n.push({ whoId: 'a', whoName: '甲', text: 'a1' })
  n.push({ whoId: 'b', whoName: '乙', text: 'b1' })
  await sleep(150)
  assert.equal(sent.length, 2)
})

test('只发一条时不写成清单', async () => {
  const sent = []
  const n = makePendingBatchingNotifier({
    stateFile: tmpState(), idleMs: 40, perDay: 30,
    onFlush: (t) => sent.push(t),
  })
  n.push({ whoId: 'u', whoName: '小明', text: '在吗' })
  await sleep(120)
  assert.equal(sent.length, 1)
  assert.match(sent[0], /【待审】小明：/)
  assert.doesNotMatch(sent[0], /1\./)
})

test('一次太多条：只列前 8 条，剩下写「还有 N 条」', async () => {
  const sent = []
  const n = makePendingBatchingNotifier({
    stateFile: tmpState(), idleMs: 40, perDay: 30,
    onFlush: (t) => sent.push(t),
  })
  for (let i = 1; i <= 11; i++) n.push({ whoId: 'u', whoName: '话痨', text: `第${i}句` })
  await sleep(120)
  assert.equal(sent.length, 1)
  assert.match(sent[0], /还有 3 条/)
})

test('一天推够额度就只进队不推', async () => {
  const sent = []
  const n = makePendingBatchingNotifier({
    stateFile: tmpState(), idleMs: 30, perDay: 1,
    onFlush: (t) => sent.push(t),
  })
  n.push({ whoId: 'a', whoName: '甲', text: 'x' })
  await sleep(100)
  n.push({ whoId: 'b', whoName: '乙', text: 'y' })
  await sleep(100)
  assert.equal(sent.length, 1, '额度用完不再推')
})
