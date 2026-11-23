const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const [repo,dir]=process.argv.slice(2);
const boot=require('./boot.cjs'),files=boot.layout(dir),framePng=f=>require(path.resolve(repo,'cli/cloadm.js')).framePng(f);
const sym=boot.symbols(files.map);
(async()=>{for(const test of ['stationary','dodge','spread']){
 const s=await boot(repo,files);
 const read=a=>s.readByte(a), val=k=>read(sym[k]), put=(k,...v)=>s.pokeBytes(sym[k],v), word=k=>val(k)*256+read(sym[k]+1);
 let field=0;const next=()=>{const start=field,n=read(512);while(n===read(512)){s.runFrames(1);if(++field-start>800)throw Error('frame timeout');}return field-start;};
 next(); const word2=a=>read(a)*256+read(a+1); const grid=(x,y)=>read(boot.GRID+128*y+x);
 let spots=[];
 const rows=Math.floor(word2(0x6e04)/128);for(let y=3;y<rows-3;y++)for(let x=3;x<121;x++){
  let good=true;for(let j=-2;j<=2;j++)for(let i=0;i<=6;i++)if(grid(x+i,y+j)!==15)good=false;
  if(good)spots.push([x,y]);}
 // Dodge (Freedoom fixture): a wall must close the row within three cells west
 // of the player, so the dodged fireball ends there before the imp's next throw.
 const westWall=([x,y])=>{for(let k=1;k<=3;k++){const c=grid(x-k,y);if(!c)return k>1;if(!(c&2))return true;}return false;};
 if(test==='dodge')spots=spots.filter(westWall);
 assert(spots.length,'no fixture for '+test);spots.sort((a,b)=>Math.hypot(a[0]-val('px'),a[1]-val('py'))-Math.hypot(b[0]-val('px'),b[1]-val('py')));
 const [x,y]=spots[0];put('px',x,128);put('py',y,128);put('angle',0);
 put('count',test==='spread'?2:1);
 put('things',x+6,y+(test==='spread'?-1:0),3,8,x+6,y+1,3,8);
 put('waitForAttack',test==='spread'?150:0,150);
 if(test==='spread'){put('gun',1);put('ownedShotgun',1);put('shells',8);}
 let fired=false,overlap=false,cast=false,shot=false,frames=[],lastHeading=0;
 for(let i=0;i<65;i++){
  const fields=next();if(i>2)frames.push(fields);
  if(val('wind')&&!cast){cast=true;fs.writeFileSync(path.join(dir,'casting.png'),framePng(s.machine.render()));}
  if(val('thrown')&&!fired){fired=true;if(test==='dodge')s.machine.setKey('X',true);}
  if(fired&&test==='dodge'&&Math.abs(word('py')-(256*y+128))>=256)s.machine.setKey('X',false);
  if(fired&&read(sym.balls+8)===57)fs.writeFileSync(path.join(dir,'fireball.png'),framePng(s.machine.render()));
  if(test==='spread'&&i===2)s.machine.setKey('SPACE',true);
  if(test==='spread'&&val('shells')<8){s.machine.setKey('SPACE',false);s.machine.setKey('LEFT',i<15);shot=true;}
  if(shot&&word('audioPos')&&val('angle')!==lastHeading)overlap=true;
  lastHeading=val('angle');
  if(test==='stationary'&&val('impacts'))break;
  if(test==='dodge'&&fired&&(!read(sym.balls+8)||val('wallHits')))break;
  if(test==='spread'&&i>22)break;
 }
 const hp=val('health'),n=frames.length,elapsed=frames.reduce((a,b)=>a+b,0);
 console.log(JSON.stringify({test,fixture:[x,y],cast,fired,hp,impacts:val('impacts'),wallHits:val('wallHits'),strafe:word('py')-(256*y+128),spreadVictims:val('spreadVictims'),controlDuringAudio:overlap,frames:n,fields:elapsed,fps:+(50*n/elapsed).toFixed(2)}));
 if(test==='stationary')assert(cast&&fired&&hp===92);
 if(test==='dodge')assert(cast&&fired&&hp===100&&Math.abs(word('py')-(256*y+128))>=256);
 if(test==='spread')assert(shot&&val('spreadVictims')===2&&overlap);
}})().catch(e=>{console.error(e);process.exitCode=1;});
