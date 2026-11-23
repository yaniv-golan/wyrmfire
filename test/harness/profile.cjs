const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const [repo,dir,out]=process.argv.slice(2);
const boot=require('./boot.cjs'),files=boot.layout(dir),framePng=f=>require(path.resolve(repo,'cli/cloadm.js')).framePng(f);
(async()=>{
const s=await boot(repo,files);
fs.mkdirSync(out,{recursive:true});
const map=fs.readFileSync(files.map,'utf8');
const symbols=Array.from(map.matchAll(/^Symbol: (_\w+) \(native.o\) = ([0-9A-F]+)/gm),m=>[parseInt(m[2],16),m[1]]).sort((a,b)=>a[0]-b[0]);
const counts={};let last=0,at=0,intervals=[],sound=0;
for(let f=1;f<5500;f++){s.runFrames(1);let n=s.readByte(0x200);if(s.machine.audioEvents.length>4)sound+=s.machine.audioEvents.length/2-1;
if(n>3){const fn=symbols.filter(x=>x[0]<=s.machine.cpu.pc).at(-1)?.[1]||'runtime';counts[fn]=(counts[fn]||0)+1;}if(n===last)continue;
if(n>1)intervals.push(f-at);at=f;last=n;
if([2,12,24,38].includes(n))fs.writeFileSync(path.join(out,'frame-'+n+'.png'),framePng(s.machine.render()));
let ram=Array.from({length:7},(_,i)=>s.readByte(0x201+i));
if(n%4===0||n===1)console.log(n,f,ram.join(','));
s.machine.setKey('UP',n>=4&&n<12);s.machine.setKey('LEFT',n>=12&&n<22);
s.machine.setKey('SPACE',n>=22&&n<30);
if(n===38){const a=intervals.slice().sort((a,b)=>a-b);console.log('fields median',a[18],'range',a[0],a.at(-1),'audio transitions',sound);console.log(counts);assert(sound>80);assert(ram[4]<50);return;}
}throw Error('timed out '+last+' PC '+s.machine.cpu.pc.toString(16));
})().catch(e=>{console.error(e);process.exitCode=1});
