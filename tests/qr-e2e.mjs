// 端到端：假 NapCat WebUI + 真 qr-login + 真 qr-image，走完一次扫码
import http from 'node:http'
import { createNapCatLogin } from '../lib/qr-login.js'
import { toDataURL } from '../lib/qr-image.js'

const state = { loggedIn: false, pollCount: 0 }
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const path = req.url
    const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)) }
    const auth = req.headers.authorization
    if (path === '/api/auth/login') { send({ code: 0, message: 'success', data: { Credential: 'BEARER-1' } }); return }
    if (auth !== 'Bearer BEARER-1') { send({ code: -1, message: 'unauthorized' }); return }
    if (path === '/api/QQLogin/GetQQLoginQrcode') { send({ data: { qrcode: 'https://qun.qq.com/qrcode/index.html?key=TESTKEY123' } }); return }
    if (path === '/api/QQLogin/CheckLoginStatus') { state.pollCount += 1; send({ data: { isLogin: state.pollCount > 1 } }); return }
    if (path === '/api/QQLogin/GetQQLoginInfo') { send({ data: { uin: '10001', online: true, nickname: '主人' } }); return }
    send({})
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

let t = 0
const login = createNapCatLogin({ webuiUrl: base, webuiToken: 'napcat_webui', now: () => t, render: (u) => toDataURL(u) })
const s = await login.start()
if (s.status !== 'waiting') throw new Error('start 状态不对: ' + s.status)
if (!s.image || !s.image.startsWith('data:image/png;base64,')) throw new Error('没有二维码图')
console.log('  ✓ 拿到二维码（dataURL ' + s.image.length + ' 字节）')
t += 2100
const p1 = await login.poll(s.id)
if (p1.status !== 'waiting') throw new Error('第一次 poll 应该是 waiting，实际 ' + p1.status)
console.log('  ✓ 第一次轮询：还没扫 → waiting')
t += 2100
const p2 = await login.poll(s.id)
if (p2.status !== 'success') throw new Error('第二次 poll 应该 success，实际 ' + p2.status)
if (p2.account?.uin !== '10001') throw new Error('账号不对: ' + JSON.stringify(p2.account))
console.log('  ✓ 第二次轮询：登录成功，账号 ' + p2.account.uin + '（' + p2.account.nickname + '）')
if (p2.image !== undefined) throw new Error('成功后不该再回传二维码')
console.log('  ✓ 成功后二维码从应答里消失了')
server.close()
console.log('\n扫码登录端到端：全过 ✓')
process.exit(0)
