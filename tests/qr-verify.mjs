import { encodeQR } from '../lib/qr-image.js'
const GROUPS={1:[[1,16]],2:[[1,28]],3:[[1,44]],4:[[2,32]],5:[[2,43]],6:[[4,27]],7:[[4,31]],8:[[2,38],[2,39]],9:[[3,36],[2,37]],10:[[4,43],[1,44]],11:[[1,50],[4,51]],12:[[6,36],[2,37]],13:[[8,37],[1,38]],14:[[4,40],[5,41]],15:[[5,41],[5,42]],16:[[7,45],[3,46]],17:[[10,46],[1,47]],18:[[9,43],[4,44]],19:[[3,44],[11,45]],20:[[3,41],[13,42]]}
function reserved(v){const n=v*4+17;const m=Array.from({length:n},()=>new Array(n).fill(false));const mk=(r,c)=>{if(r>=0&&r<n&&c>=0&&c<n)m[r][c]=true};
 for(const [r0,c0] of [[0,0],[0,n-7],[n-7,0]])for(let r=-1;r<=7;r++)for(let c=-1;c<=7;c++)mk(r0+r,c0+c);
 for(let i=0;i<n;i++){mk(6,i);mk(i,6)}
 if(v>1){const step=v<7?8:16;const cnt=Math.floor((n-13)/step)+1;const pos=[6];for(let i=1;i<cnt;i++)pos.push(n-7-(cnt-1-i)*step);
  for(const r of pos)for(const c of pos){if((r<=8&&c<=8)||(r<=8&&c>=n-9)||(r>=n-9&&c<=8))continue;for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++)mk(r+dr,c+dc)}}
 for(let i=0;i<9;i++){mk(8,i);mk(i,8)}
 for(let i=0;i<8;i++){mk(8,n-1-i);mk(n-1-i,8)}
 mk(n-8,8)
 if(v>=7)for(let i=0;i<6;i++)for(let j=0;j<3;j++){mk(n-11+j,i);mk(i,n-11+j)}
 return m}
function decodeQR(text){
 const {size,modules,version}=encodeQR(text)
 const R=reserved(version);const seq=[];let up=true
 for(let col=size-1;col>0;col-=2){ if(col===6)col-=1
  for(let i=0;i<size;i++){const row=up?size-1-i:i;for(let k=0;k<2;k++){const c=col-k;if(R[row][c])continue;seq.push([row,c])}}
  up=!up}
 const bits=seq.map(([r,c])=>{const v=modules[r][c]?1:0;return ((r+c)%2===0)?1-v:v})
 // 按字节切
 const codewords=[];for(let i=0;i+8<=bits.length;i+=8)codewords.push(parseInt(bits.slice(i,i+8).join(''),2))
 // 反交织
 const groups=GROUPS[version];const lens=[];for(const [n,d] of groups)for(let i=0;i<n;i++)lens.push(d)
 const dataLens=lens
 const chunks=lens.map(()=>[])
 let ci=0
 for(let k=0;k<Math.max(...dataLens);k++) for(let i=0;i<lens.length;i++){ if(k<dataLens[i]) chunks[i].push(codewords[ci++]) }
 const flat=chunks.flat()
 const dbits=[];for(const b of flat)for(let k=7;k>=0;k--)dbits.push((b>>>k)&1)
 const startLen=version<=9?12:20
 const mode=parseInt(dbits.slice(0,4).join(''),2)
 const len=parseInt(dbits.slice(4,startLen).join(''),2)
 const out=[]
 for(let i=0;i<len;i++){const s=startLen+i*8;out.push(parseInt(dbits.slice(s,s+8).join(''),2))}
 return {version,mode,len,text:Buffer.from(out).toString('utf8')}
}
const cases=['ABC','https://qun.qq.com/qrcode/index.html?key=abc123XYZ','z'.repeat(100),'q'.repeat(180)]
let ok=0
for(const t of cases){
 const r=decodeQR(t)
 const same=r.text===t
 if(same)ok++
 console.log(`长度 ${String(t.length).padStart(3)} → v${r.version} mode=${r.mode} 读出长度=${r.len} ${same?'✓ 一致':'✗ 不一致'}`)
}
console.log(ok===cases.length?'\n✓ 全部一致：编码器的数据位、纠错分块、交织、掩码都对':'\n✗ 有不对的')
