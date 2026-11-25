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
 // SND_HURT is ASSET 17 (src/disk.h). The table holds OFFSETS from ASSETS (0x5000), not addresses
 // (src/disk.h: ASSET(i) = ASSETS + offsets[i]), so the asset's start is ASSETS + offset.
 const ASSETS=0x5000, assetOff=(i)=>read(ASSETS+8+i*4)*256+read(ASSETS+8+i*4+1), assetLen=(i)=>read(ASSETS+8+i*4+2)*256+read(ASSETS+8+i*4+3);
 const hurtAddr=ASSETS+assetOff(17), hurtEnd=hurtAddr+assetLen(17);
 // item 1: the VDG's colour-set bit (CSS, $FF22 bit 3 -- 1 normal, 0 inverted for the hit flash), the impact
 // count, and whether SND_HURT is the sound in flight, sampled EXACTLY at each picture boundary: at the
 // instruction after the one that stored $0200 (pcWatch runs before every instruction). They used to be sampled
 // once per emulator frame, which depends on where the frame boundary falls inside the main loop -- draw() writes
 // CSS before its $0200 store, and the next pass's simulate() may run before the frame ends -- so a few cycles a
 // picture anywhere in the engine (the field clock's interrupt is about 375) moved the flash by one sample. These
 // samples cannot move.
 const exact=[];let lastPicture=read(512);
 s.machine.pcWatch=()=>{const v=read(512);if(v===lastPicture)return;lastPicture=v;
  const ap=word('audioPos');exact.push({css:(s.machine.pia1.b.outValue()>>3)&1,impacts:val('impacts'),hurt:ap>=hurtAddr&&ap<hurtEnd});};
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
  if(test==='stationary'&&val('impacts')){
    for(let k=0;k<3;k++)next();   // the flash picture and the ones after it, for the exact samples
    break;
  }
  if(test==='dodge'&&fired&&(!read(sym.balls+8)||val('wallHits')))break;
  if(test==='spread'&&i>22)break;
 }
 const hp=val('health'),n=frames.length,elapsed=frames.reduce((a,b)=>a+b,0);
 console.log(JSON.stringify({test,fixture:[x,y],cast,fired,hp,impacts:val('impacts'),wallHits:val('wallHits'),strafe:word('py')-(256*y+128),spreadVictims:val('spreadVictims'),controlDuringAudio:overlap,frames:n,fields:elapsed,fps:+(50*n/elapsed).toFixed(2)}));
 s.machine.pcWatch=null;
 if(test==='stationary'){
    assert(cast&&fired&&hp===92);
    /* ITEM 1, at the exact picture boundaries (see `exact`): the impact is counted in simulate() and the SAME
     * pass's draw() shows the flash, so the first picture that ends with impacts>0 is the one picture with CSS=0;
     * the next has CSS=1 back, and SND_HURT is in flight on the flash picture. */
     const hitAt=exact.findIndex(p=>p.impacts>0),flash=exact.map((p,i)=>p.css===0?i:-1).filter(i=>i>=0);
     if(process.env.ENCOUNTER_VERBOSE)console.log(JSON.stringify({hitAt,flash,around:exact.slice(Math.max(0,hitAt-2),hitAt+3)}));
     assert.ok(hitAt>=0,'no picture ended with the impact counted');
     assert.deepEqual(flash,[hitAt],`at the picture boundaries the flash was on pictures [${flash}], want exactly [${hitAt}], the picture the impact was counted in`);
     assert.equal(exact[hitAt+1]&&exact[hitAt+1].css,1,'the colour set was still inverted one picture after the flash');
     assert.ok(exact[hitAt].hurt,'SND_HURT was not the sound in flight on the flash picture');
  }
 if(test==='dodge')assert(cast&&fired&&hp===100&&Math.abs(word('py')-(256*y+128))>=256);
 if(test==='spread')assert(shot&&val('spreadVictims')===2&&overlap);
}})().catch(e=>{console.error(e);process.exitCode=1;});
