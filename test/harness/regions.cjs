// Disk-region load probe. For every region of the mounted level, place the player on one of its cells (writing
// px/py like the encounter harness) and time the LOAD ITSELF: from the instruction that enters diskRead() to the
// instruction after which currentArea is the new region, i.e. the seek, the transfer, the checksum and the LZ
// unpack, in PAL fields (cycles / cycles-per-field, to a tenth).
//
// It used to report "stall": the two pictures around the load minus two resident pictures. That is a difference
// against the renderer, so it grows when ordinary pictures get cheaper and the disk does exactly what it did (a
// resident picture going from 6 fields to 3 read as stalls of 38 -> 40). The load is what the player waits for
// and what a change to the loader can make worse, so it is measured on its own; the picture times are still in
// the rows (pictureFields: the two pictures around the load; residentFields: the next one).
// The load is reported in its two parts as well: readFields, the seek and the transfer (which wait on the disk's
// rotation, so a build that reaches the load at another moment can gain or lose a revolution, 10 fields, on a
// region), and unpackFields, the checksum and the LZ unpack (CPU only: the same on every build that does not
// change them).
//   node regions.cjs CLOADM_DIR BUILD_DIR [out.json] [--max-unpack-fields N] [--max-read-fields N]
// The limits fail the run when the regions' unpackFields, or their readFields, add up to more than N. CI passes
// main's sums (2f47134: 2,076.5 and 2,763.4 for Freedoom E1M1) plus 0.5% for the unpack, which no change to the
// renderer moves, and plus 5% for the read, which is what rotational phase can move (docs/PERFORMANCE.md).
const fs=require('fs');
const argv=process.argv.slice(2),limit=(flag)=>{const i=argv.indexOf(flag);return i>=0?Number(argv.splice(i,2)[1]):null;};
const maxRead=limit('--max-read-fields'),maxUnpack=limit('--max-unpack-fields');
const [repo,dir,out]=argv;
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
  let from=-1,read=-1,to=-1;const m=s.machine,F=Math.round(m.tickHz/50);
  m.pcWatch=(pc)=>{if(from<0){if(pc===sym.diskRead)from=m.cycle;}else if(to<0){if(read<0&&pc===sym.checksum)read=m.cycle;if(r(sym.currentArea)===z)to=m.cycle;}};
  const p1=next(),p2=next(),resident=next();m.pcWatch=null;
  if(to<0)throw Error('region '+z+' was not loaded');
  rows.push({region:z,cell,sectors:r(sectors+z-1),rawBytes:w(raw+2*(z-1)),loadFields:+((to-from)/F).toFixed(1),readFields:+((read-from)/F).toFixed(1),unpackFields:+((to-read)/F).toFixed(1),pictureFields:p1+p2,residentFields:resident,area:r(sym.currentArea)});
}
const ld=rows.map(x=>x.loadFields).sort((a,b)=>a-b),sum=+rows.reduce((t,x)=>t+x.loadFields,0).toFixed(1);
const part=k=>+rows.reduce((t,x)=>t+x[k],0).toFixed(1);
const summary={regions,probed:rows.length,loadFieldsSum:sum,readFieldsSum:part('readFields'),unpackFieldsSum:part('unpackFields'),loadFieldsMin:ld[0],loadFieldsMedian:ld[ld.length>>1],loadFieldsMax:ld.at(-1),pictureFieldsSum:rows.reduce((t,x)=>t+x.pictureFields,0)};
// Least-squares fit loadFields = a + b*sectors, used to project other maps.
const n=rows.length,sx=rows.reduce((t,x)=>t+x.sectors,0),sy=sum,sxx=rows.reduce((t,x)=>t+x.sectors*x.sectors,0),sxy=rows.reduce((t,x)=>t+x.sectors*x.loadFields,0);
const b=(n*sxy-sx*sy)/(n*sxx-sx*sx||1),a=(sy-b*sx)/n;summary.fit={fieldsPerSector:+b.toFixed(3),baseFields:+a.toFixed(2)};
console.log(JSON.stringify(summary));
if(out)fs.writeFileSync(out,JSON.stringify({summary,rows},null,1)+'\n');
if(rows.some(x=>x.area!==x.region))throw Error('engine did not switch to the probed region');
if(maxUnpack!==null&&summary.unpackFieldsSum>maxUnpack)throw Error('checking and unpacking the '+rows.length+' regions took '+summary.unpackFieldsSum+' fields in all, more than the '+maxUnpack+' allowed: the load path got slower');
if(maxRead!==null&&summary.readFieldsSum>maxRead)throw Error('reading the '+rows.length+' regions took '+summary.readFieldsSum+' fields in all, more than the '+maxRead+' allowed: the load path got slower');
})().catch(e=>{console.error(e);process.exitCode=1;});
