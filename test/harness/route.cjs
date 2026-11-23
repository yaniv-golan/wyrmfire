const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const [repo,dir,branch='normal']=process.argv.slice(2);
const boot=require('./boot.cjs'),files=boot.layout(dir),framePng=f=>require(path.resolve(repo,'cli/cloadm.js')).framePng(f);
const addr=boot.symbols(files.map);
(async()=>{
 const s=await boot(repo,files);
 const r=a=>s.readByte(a),v=name=>r(addr[name]),read16=a=>r(a)*256+r(a+1);
 const g=i=>r(boot.GRID+i), controls=['LEFT','RIGHT','SPACE','UP','E'];
 let previousZone=0,zoneFields=[],residentFields=[];let lastField=0,frame=0,started=false,prevLevel=-1,lastUse=false,steps=0,prevCell=-1,stuck=0,route=[],seen=[],firstAt=0;
 for(let field=0;field<2000000;field++){
    s.runFrames(1);
    const f=r(0x200);if(f===frame){if(field-lastField>700)throw Error('Game stopped producing pictures on map '+(v('level')+1)+' at field '+field+' PC '+s.machine.cpu.pc.toString(16));continue;}if(steps){(previousZone===v("currentArea")?residentFields:zoneFields).push(field-lastField);}previousZone=v("currentArea");lastField=field;frame=f;steps++;
    const level=v('level')+1,ang=v('angle'),hp=v('health'),keys=v('keys');
    if(v('won')){fs.writeFileSync(path.join(dir,'exit.png'),framePng(s.machine.render()));for(const [label,arr] of [['resident',residentFields],['region changes',zoneFields]]){arr.sort((a,b)=>a-b);console.log(label,'frames',arr.length,'fields',arr.reduce((a,b)=>a+b,0),'median',arr[arr.length>>1],'max',Math.max(...arr));}console.log('Campaign clear' ,seen,steps,'pictures',field,'PAL fields');return;}
    if(v('rise')===4&&!fs.existsSync(path.join(dir,'door.png')))fs.writeFileSync(path.join(dir,'door.png'),framePng(s.machine.render()));
    if(steps%20===0)console.log("step",steps,field,"cell",v("px"),v("py"),"disk",v("diskError"),v("currentArea"));
    if(level!==prevLevel){console.log('E1M'+level,'health',hp,'ammo',v('ammo'),'at',steps,field);prevLevel=level;seen.push(level);firstAt=steps;
      if(level===2&&process.env.ONE_LEVEL)return;
    }
    if(!hp)throw Error('Player died at E1M'+level+' after '+steps);
    const px=read16(addr.px),py=read16(addr.py),cell=(py>>8)*128+(px>>8);
    const same=cell===prevCell;stuck=same?stuck+1:0;prevCell=cell;
    const k=new Set();const goalSecret=level===3&&branch==='secret'&&!seen.includes(9);
    // Search from the current cell to an exit or reachable key using only map reads.
    // Preserve real door/actor state. All player actions go through the keyboard.
    const q=[cell],from=new Map([[cell,-1]]);let dest,nearestKey=-1;
    const bosses=new Set(),pickup=new Set();
    for(let i=0;i<v('count');i++){const a=addr.things+4*i,kind=r(a+2);if(kind===5)bosses.add(r(a)+128*r(a+1));if(kind>=9&&kind<=11&&!(keys&(1<<(kind-9))))pickup.add(r(a)+128*r(a+1));}
    for(let j=0;j<q.length;j++){
      const n=q[j],c=g(n);
      if(level===8&&bosses.size){
        if([1,-1,128,-128].some(delta=>bosses.has(n+delta))){dest=n;break;}
      }else if((c&32)&&!!(c&64)===goalSecret){dest=n;break;}
      if(nearestKey===-1&&pickup.has(n))nearestKey=n;
      for(const [bit,d] of [[1,1],[2,-1],[4,128],[8,-128]]){
        const z=n+d,t=g(z);if(!(c&bit)||from.has(z)||((t&16)&&(t>>6)&&!(keys&(1<<((t>>6)-1)))))continue;
        from.set(z,n);q.push(z);
      }
    }
    if(dest==null)dest=nearestKey;
    if(dest<0||dest==null)throw Error('No reachable exit or new key on E1M'+level+' cell '+cell+' keys '+keys);
    if(cell===dest){if(!lastUse)k.add('E');
      if(level===8 && bosses.size){
        let boss;for(let i=0;i<v('count');i++){let a=addr.things+i*4;if(r(a+2)===5&&Math.abs(r(a)-(px>>8))+Math.abs(r(a+1)-(py>>8))===1){boss=[r(a),r(a+1)];break;}}
        if(boss){const dx=boss[0]-(px>>8),dy=boss[1]-(py>>8);let a=Math.round(Math.atan2(dy,dx)*16/Math.PI+32)%32;
          if(ang!==a)k.add(((a-ang+32)%32)<16?'LEFT':'RIGHT');}
      }
    }else{
      let next=dest;while(from.get(next)!==cell){next=from.get(next);if(next==null)throw Error("Broken path to "+dest);}
      let d=next-cell,a=d===1?0:d===128?8:d===-1?16:24;
      if(ang!==a)k.add(((a-ang+32)%32)<16?'LEFT':'RIGHT');
      else if(g(next)&16){if(!lastUse)k.add('E');k.add('UP');}else k.add('UP');
    }
    if(v('target')!==255)k.add('SPACE');
    if(stuck>90||steps-firstAt>4200)throw Error('No progress E1M'+level+' cell '+cell+' goal '+dest+' keys '+keys+' angle '+ang+' hp '+hp);
    lastUse=k.has('E');for(const name of controls)s.machine.setKey(name,k.has(name));
    if(seen.length===1&&steps===150)fs.writeFileSync(path.join(dir,'traverse.png'),framePng(s.machine.render()));
 }throw Error('Field limit');
})().catch(e=>{console.error(e);process.exitCode=1;});
