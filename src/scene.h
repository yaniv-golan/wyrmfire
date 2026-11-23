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
static byte oldSignature[2][32][6],doorVis[32],wallTop[32],wallBottom[32];
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
    sta 0,x
    sta 32,x
    sta 64,x
    sta 96,x
    sta 128,x
    sta 160,x
    sta 192,x
    sta 224,x
    sta 256,x
    sta 288,x
    sta 320,x
    sta 352,x
    sta 384,x
    sta 416,x
    sta 448,x
    sta 480,x
    sta 512,x
    sta 544,x
    sta 576,x
    sta 608,x
    sta 640,x
    sta 672,x
    sta 704,x
    sta 736,x
    sta 768,x
    sta 800,x
    sta 832,x
    sta 864,x
    sta 896,x
    sta 928,x
    sta 960,x
    sta 992,x
    sta 1024,x
    sta 1056,x
    sta 1088,x
    sta 1120,x
    sta 1152,x
    sta 1184,x
    sta 1216,x
    sta 1248,x
    sta 1280,x
    sta 1312,x
    sta 1344,x
    sta 1376,x
    sta 1408,x
    sta 1440,x
    sta 1472,x
    sta 1504,x
    sta 1536,x
    sta 1568,x
    sta 1600,x
    sta 1632,x
    sta 1664,x
    sta 1696,x
    sta 1728,x
    sta 1760,x
    sta 1792,x
    sta 1824,x
    sta 1856,x
    sta 1888,x
    sta 1920,x
    sta 1952,x
    sta 1984,x
    sta 2016,x
    sta 2048,x
    sta 2080,x
    sta 2112,x
    sta 2144,x
    sta 2176,x
    sta 2208,x
    sta 2240,x
    sta 2272,x
    sta 2304,x
    sta 2336,x
    sta 2368,x
    sta 2400,x
    sta 2432,x
    sta 2464,x
    sta 2496,x
    sta 2528,x
    sta 2560,x
    sta 2592,x
    sta 2624,x
    sta 2656,x
    sta 2688,x
    sta 2720,x
    sta 2752,x
    sta 2784,x
    sta 2816,x
    sta 2848,x
    sta 2880,x
    sta 2912,x
    sta 2944,x
    sta 2976,x
    sta 3008,x
    sta 3040,x
    sta 3072,x
    sta 3104,x
    sta 3136,x
    sta 3168,x
    sta 3200,x
    sta 3232,x
    sta 3264,x
    sta 3296,x
    sta 3328,x
    sta 3360,x
    sta 3392,x
    sta 3424,x
    sta 3456,x
    sta 3488,x
    sta 3520,x
    sta 3552,x
    sta 3584,x
    sta 3616,x
    sta 3648,x
    sta 3680,x
    sta 3712,x
    sta 3744,x
    sta 3776,x
    sta 3808,x
    sta 3840,x
    sta 3872,x
    sta 3904,x
    sta 3936,x
    sta 3968,x
    sta 4000,x
    sta 4032,x
    sta 4064,x
    sta 4096,x
    sta 4128,x
    sta 4160,x
    sta 4192,x
    sta 4224,x
    sta 4256,x
    sta 4288,x
    sta 4320,x
    sta 4352,x
    sta 4384,x
    sta 4416,x
    sta 4448,x
    sta 4480,x
    sta 4512,x
    sta 4544,x
    sta 4576,x
    sta 4608,x
    sta 4640,x
    sta 4672,x
    sta 4704,x
    sta 4736,x
    sta 4768,x
    sta 4800,x
    sta 4832,x
    sta 4864,x
    sta 4896,x
    sta 4928,x
    sta 4960,x
    sta 4992,x
    sta 5024,x
    sta 5056,x
    sta 5088,x
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

 sig=oldSignature[page][0];dirty=dirtyCols[page];
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
