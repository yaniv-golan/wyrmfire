const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const [repo,dir]=process.argv.slice(2);
const boot=require('./boot.cjs'),files=boot.layout(dir),framePng=f=>require(path.resolve(repo,'cli/cloadm.js')).framePng(f);
(async()=>{
const s=await boot(repo,files);
let prev=0,fire=0,intro=0,samples=[],pix=0;
const clips=path.join(dir,'clip');fs.mkdirSync(clips,{recursive:true});
for(let field=0;field<800;field++){
 s.runFrames(1);let m=s.machine,ev=m.audioEvents;
 const n=Math.round((field+1)*16000/m.fps)-Math.round(field*16000/m.fps);
 for(let i=0,j=0;i<n;i++){
   while(j+2<ev.length&&ev[j+2]<=i*m.frameCycles/n)j+=2;
   samples.push((ev[j+1]??0)-32/63);
 }
 let f=s.readByte(0x200);
 if(!f)intro+=Math.max(0,ev.length/2-1);
 if(f>=22&&f<=32)fire+=Math.max(0,ev.length/2-1);
 if(f!==prev){prev=f;s.machine.setKey('UP',f>=4&&f<12);s.machine.setKey('LEFT',f>=12&&f<22);s.machine.setKey('SPACE',f>=22&&f<30);}
 if(field%5===0){fs.writeFileSync(path.join(clips,'view'+String(++pix).padStart(3,'0')+'.png'),framePng(m.render()));}
 if(f>=38)break;
}
assert(prev>=38&&intro>40&&fire>100&&s.readByte(0x205)<50);
const {writeWav}=s.Emu;
fs.writeFileSync(path.join(clips,'speaker.wav'),writeWav(samples,16000));
console.log('Mounted disk, controls and DAC PASS. Intro transitions',intro,'firing transitions',fire,'pictures',prev,'clip frames',pix);
})().catch(e=>{console.error(e);process.exitCode=1;});
