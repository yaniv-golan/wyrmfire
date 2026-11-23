// Swap test: the same executable reads a new spawn from a replacement level
// disk after the clear screen. node swap.cjs CLOADM_DIR BUILD_DIR
const fs=require('fs'),assert=require('assert/strict');
const [repo,dir]=process.argv.slice(2);
(async()=>{
const boot=require('./boot.cjs'),files=boot.layout(dir),sym=boot.symbols(files.map);
const s=await boot(repo,files);
const tick=()=>{const v=s.readByte(512);for(let i=0;i<800;i++){s.machine.setKey('ENTER',i%50<25);s.runFrames(1);if(s.readByte(512)!==v){s.machine.setKey('ENTER',false);return;}}throw Error('timed out');};
const original=Buffer.from(fs.readFileSync(files.vdk)),H=12+boot.HEADER_SECTOR*256;
tick();assert.equal(s.readByte(sym.px),original[H+7]);
// Alternate spawn: the last plain reachable cell of the grid.
const size=original[H+4]*256+original[H+5];let cell=-1;
for(let i=size-1;i>=0;i--){const c=s.readByte(boot.GRID+i);if((c&15)&&!(c&48)){cell=i;break;}}
const X=cell%128,Y=cell>>7;assert(cell>=0&&(X!==original[H+7]||Y!==original[H+8]));
const alternate=Buffer.from(original);alternate[H+7]=X;alternate[H+8]=Y;
s.swapLevelDisk(alternate);s.pokeBytes(sym.won,[1]);s.machine.setKey('ENTER',true);
for(let n=0;n<8&&s.readByte(sym.px)!==X;n++)tick();
assert.equal(s.readByte(sym.px),X);assert.equal(s.readByte(sym.py),Y);
console.log('Same executable read spawn ('+X+','+Y+') from the replacement level disk after the clear screen.');
})().catch(e=>{console.error(e);process.exitCode=1;});
