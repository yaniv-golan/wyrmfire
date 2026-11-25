static byte *columnOut;
static byte runSize,runInk;
static asm void putRun(){
 asm {
   ldx _columnOut
   lda _runInk
   ldb _runSize
   pshs b
   lsrb
   lsrb
   lsrb
   beq @tail
@eight sta ,x
   sta 32,x
   sta 64,x
   sta 96,x
   sta 128,x
   sta 160,x
   sta 192,x
   sta 224,x
   leax 256,x
   decb
   bne @eight
@tail puls b
   andb #7
   beq @end
@one sta ,x
   leax 32,x
   decb
   bne @one
@end stx _columnOut
   rts
 }
}
static void band(byte top,byte bottom,byte bits){
 if(bottom<=top)return;
 columnOut=back+((word)top<<5)+col;
 *columnOut=255;if(bits){columnOut+=32;runSize=bottom-top-1;runInk=bits;putRun();}else{columnOut=back+((word)bottom<<5)+col;}*columnOut=255;
}
#define AREA ((byte*)0x7a00)
#define AREA_END ((byte*)0xac00)
static byte currentArea,loadFailure;
static word verifyLength;
static byte *verifyStart;
static asm word checksum(){
 asm {
    pshs y
    ldx _verifyStart
    ldy _verifyLength
    clra
    clrb
@sum addb ,x+
    adca #0
    leay -1,y
    bne @sum
    puls y,pc
 }
}
static byte *viewAt(byte x,byte y){
 byte slot=AREA[((y&3)<<2)+(x&3)];return slot?AREA+16+(word)(slot-1)*768:(byte*)0;
}
static byte areaAt(byte x,byte y){return zoneIndex[((word)(y>>2)<<5)+(x>>2)];}
static byte loadArea(byte zone){
 if(zone==currentArea)return 1;
 if(!zone)return 0;
 {
    /* HGR2: read the region's sectors to the top of the AREA window and
     * unpack in place towards its start; the converter guarantees the
     * output never overtakes unread input. */
    verifyLength=(word)diskCount[zone-1]<<8;
    verifyStart=AREA_END-verifyLength;
    if(!diskRead(diskOffset[zone-1],diskCount[zone-1],verifyStart)){loadFailure=1;return 0;}
    if(checksum()!=((word *)(PACK+*(word *)(PACK+28)))[zone-1]){loadFailure=1;return 0;}
    source=verifyStart;
 }
 unpackTarget=AREA;length=(word)(AREA+rawSize[zone-1]);decompress();
 currentArea=zone;loadFailure=0;return 1;
}
/* The column cache, oldSignature[page][col][6] as it was, (2 pages x 32 columns x 6 bytes = 384), lives in low RAM at $0208-$0387, not
 * in the engine image: nothing writes $0208-$03FF while the engine runs (measured: over 3,000 fields of play the
 * only CPU writes below $0400 are the $0200-$0207 markers), and the 384 bytes are what lets the field clock and
 * the credits screen both fit below ASSETS at $5000. Low RAM is not part of the loaded image, so main() zeroes
 * it before the first picture (clearSignatures). */
#define SIGNATURES ((byte*)0x208)
static void clearSignatures(){word i;for(i=0;i<384;i++)SIGNATURES[i]=0;}
static byte doorVis[32],wallTop[32],wallBottom[32];
static const byte *view,*adjacent;
static byte blendWeight;
static byte angularIndex,sampled[4];
static asm void samples(){
 asm {
    pshs y
    ldx _view
    ldb _angularIndex
    leax b,x
    ldy _adjacent
    lbeq @copy
    leay b,y
    lda 0,y
    suba 0,x
    bcc @pos0
    nega
    ldb _blendWeight
    mul
    addd #128
    nega
    bra @save0
@pos0 ldb _blendWeight
    mul
    addd #128
@save0 adda 0,x
    sta _sampled+0
    lda 96,y
    suba 96,x
    bcc @pos1
    nega
    ldb _blendWeight
    mul
    addd #128
    nega
    bra @save1
@pos1 ldb _blendWeight
    mul
    addd #128
@save1 adda 96,x
    sta _sampled+1
    lda 192,y
    suba 192,x
    bcc @pos2
    nega
    ldb _blendWeight
    mul
    addd #128
    nega
    bra @save2
@pos2 ldb _blendWeight
    mul
    addd #128
@save2 adda 192,x
    sta _sampled+2
    lda 288,y
    suba 288,x
    bcc @pos3
    nega
    ldb _blendWeight
    mul
    addd #128
    nega
    bra @save3
@pos3 ldb _blendWeight
    mul
    addd #128
@save3 adda 288,x
    sta _sampled+3
    puls y,pc
@copy
    lda 0,x
    sta _sampled+0
    lda 96,x
    sta _sampled+1
    lda 192,x
    sta _sampled+2
    lda 288,x
    sta _sampled+3
    puls y,pc
 }
}
static asm void clearColumn(){
 asm {
    ldx _columnOut
    clra
    ldb #20
loop
    sta 0,x
    sta 32,x
    sta 64,x
    sta 96,x
    sta 128,x
    sta 160,x
    sta 192,x
    sta 224,x
    leax 256,x
    decb
    bne loop
    rts
 }
}
static void eraseBand(byte top,byte bottom,byte ink){
 if(bottom<=top)return;
 columnOut=back+((word)top<<5)+col;
 if(ink){runSize=bottom-top+1;runInk=0;putRun();}
 else{*columnOut=0;back[((word)bottom<<5)+col]=0;}
}
static byte doorAhead;
static void scene(){
 byte x=px>>8,y=py>>8,otherX=x,otherY=y,start=angle*3;
 byte a,b,c,d,ink,edge,j;byte *sig,*dirty;const byte *vp;
 int dx=(int)(byte)px-128,dy=(int)(byte)py-128;
 page=back==(byte*)0xe000;
 if(!loadArea(areaAt(x,y)))return;
 view=viewAt(x,y);if(!view)return;
 if(dx<0? -dx>(dy<0?-dy:dy):dx>(dy<0?-dy:dy)){otherX+=dx<0?-1:1;blendWeight=dx<0?-dx:dx;}
 else{otherY+=dy<0?-1:1;blendWeight=dy<0?-dy:dy;}
 adjacent=0;
 if(blendWeight>8&&areaAt(otherX,otherY)==currentArea&&cross(x,y,otherX,otherY))adjacent=viewAt(otherX,otherY);

 sig=page?SIGNATURES+192:SIGNATURES;dirty=dirtyCols[page];
 for(col=0;col<32;col++,sig+=6,dirty++){
    int k=(int)start+rayOffset[col];audioSlice();
    if(k<0)k+=96;else if(k>=96)k-=96;j=(byte)k;
    angularIndex=j;vp=view+j;samples();a=sampled[0];b=sampled[1];c=sampled[2];d=sampled[3];
    rayDistance[col]=vp[384];ink=vp[672];
    edge=vp[576];doorVis[col]=edge>1;
    if(edge>1){byte lift=phase[edge-1];if(lift>=8){c=d=0;}else{d-=((word)(d-c)*lift)>>3;if(lift<6)rayDistance[col]=vp[480];}}
    if(!edge)c=d=0;
    edge=edge>1?0x99:((ink&4)?0x80:0x00);
    ink=(ink&2)?0x80:((ink&1)?0xff:(shading?0x11:0));
    wallTop[col]=a;wallBottom[col]=b;
    if(!*dirty&&sig[0]==a&&sig[1]==b&&sig[2]==c&&sig[3]==d&&sig[4]==ink&&sig[5]==edge)continue;
    if(*dirty||((sig[4]||sig[5])&&(sig[1]-sig[0]>56))){columnOut=back+col;clearColumn();}
    else{eraseBand(sig[0],sig[1],sig[4]);eraseBand(sig[2],sig[3],sig[5]);}
    sig[0]=a;sig[1]=b;sig[2]=c;sig[3]=d;sig[4]=ink;sig[5]=edge;
    band(a,b,ink);band(c,d,edge);*dirty=0;
 }
}
