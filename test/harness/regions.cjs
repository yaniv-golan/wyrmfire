// Disk-region stall probe. For every region of the mounted level, place the
// player on one of its cells (writing px/py like the encounter harness) and
// count PAL fields until the next picture: the frame that crosses into a new
// region includes the sector reads, checksum and LZ unpack. A second frame in
// the same region gives the resident baseline.
//   node regions.cjs CLOADM_DIR BUILD_DIR [out.json]
const fs=require('fs');
const [repo,dir,out]=process.argv.slice(2);
(async()=>{
const boot=require('./boot.cjs'),files=boot.layout(dir),sym=boot.symbols(files.map);
const s=await boot(repo,files);
const r=a=>s.readByte(a),w=a=>r(a)*256+r(a+1),PACK=0x6e00;
const next=()=>{const v=r(0x200);let n=0;while(r(0x200)===v){s.machine.setKey('ENTER',r(0x200)===0&&n%50<25);s.runFrames(1);if(++n>2000)throw Error('no picture; PC '+s.machine.cpu.pc.toString(16));}s.machine.setKey('ENTER',false);return n;};
next();next();
const size=w(PACK+4),zone=PACK+w(PACK+16),sectors=PACK+w(PACK+20),raw=PACK+w(PACK+22),regions=r(PACK+11);
const first=new Map();
for(let i=0;i<size;i++){const c=r(boot.GRID+i);if(!(c&15)||(c&16))continue;const z=r(zone+((i>>9)<<5)+((i&127)>>2));if(z&&!first.has(z))first.set(z,i);}
const rows=[];
for(const [z,cell] of [...first.entries()].sort((a,b)=>a[0]-b[0])){
  s.pokeBytes(sym.px,[cell&127,128]);s.pokeBytes(sym.py,[cell>>7,128]);
  // The region loads in the first or the second picture after the move,
  // depending on where the main loop was; count both against a resident one.
  const p1=next(),p2=next(),resident=next(),load=p1+p2-resident;
  rows.push({region:z,cell,sectors:r(sectors+z-1),rawBytes:w(raw+2*(z-1)),loadFields:load,residentFields:resident,stallFields:load-resident,area:r(sym.currentArea)});
}
// loadFields: PAL fields of the picture that read, checked and unpacked the
// region (seek + transfer + checksum + LZ) including its redraw.
const ld=rows.map(x=>x.loadFields).sort((a,b)=>a-b),st=rows.map(x=>x.stallFields).sort((a,b)=>a-b);
const summary={regions,probed:rows.length,loadFieldsMin:ld[0],loadFieldsMedian:ld[ld.length>>1],loadFieldsMax:ld.at(-1),stallFieldsMedian:st[st.length>>1],stallFieldsMax:st.at(-1)};
// Least-squares fit stallFields = a + b*sectors, used to project other maps.
const n=rows.length,sx=rows.reduce((t,x)=>t+x.sectors,0),sy=rows.reduce((t,x)=>t+x.stallFields,0),sxx=rows.reduce((t,x)=>t+x.sectors*x.sectors,0),sxy=rows.reduce((t,x)=>t+x.sectors*x.stallFields,0);
const b=(n*sxy-sx*sy)/(n*sxx-sx*sx||1),a=(sy-b*sx)/n;summary.fit={fieldsPerSector:+b.toFixed(3),baseFields:+a.toFixed(2)};
console.log(JSON.stringify(summary));
if(out)fs.writeFileSync(out,JSON.stringify({summary,rows},null,1)+'\n');
if(rows.some(x=>x.area!==x.region))throw Error('engine did not switch to the probed region');
})().catch(e=>{console.error(e);process.exitCode=1;});
