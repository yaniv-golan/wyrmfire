/* WYRMFIRE: standalone 6809 first-person engine for the Dragon 64.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * The binary holds engine code and engine-owned data (font, math tables).
 * Levels, sprites, music and sounds are read from the level disk. */
typedef unsigned char byte;
typedef signed char sb;
typedef unsigned int word;
#include "disk.h"
#include "tables.h"
#include "font.h"
#define IO(a) (*(byte*)(a))
#define GRID ((byte*)0xac00)
#include "clock.h"
typedef struct {byte x,y,kind,hp;} Thing;
static Thing things[MAX_OBJECTS];
static byte shells,ownedShotgun,armor,targetDepth;
static byte count,level,angle,health,ammo,gun,keys,kills,won,flashTime,cooldown,hurtFlash;
static byte turn,rayDistance[32];
static word px,py; /* high byte = map cell, low byte = fraction */
static byte *back;
static const byte *source;
static word length;static byte *unpackTarget;
/* Fixed RAM outside the engine image (the image ends just under ASSETS at $5000): low RAM $0388-$03DF, above the
 * column cache (scene.h), zeroed by clearSignatures(); and $F800-$F97F, above the $E000 screen and below the
 * scaled-frame cache (actors). Nothing else writes either range (measured over play: only the stack, from $FDFF
 * down, lives above the screen). The harnesses read these #defines as symbols (test/harness/boot.cjs). */
#define phase ((byte*)0x388)
#define wind ((byte*)0xf800)
#define waitForAttack ((byte*)0xf840)
#define nearby ((byte*)0xf880)
#define dirtyCols(p) ((byte*)0xf8c0+((word)(p)<<5))
#define aimColumn ((byte*)0xf900)
#define aimDepth ((byte*)0xf940)
static byte movingDoor,rise;
static void animateDoor(){byte i;if(!movingDoor)return;rise=++phase[movingDoor];if(rise==7)for(i=0;i<PACK[10];i++)if(doorGroups[i]==movingDoor)GRID[doorCells[i]]&=15;if(rise>=8)movingDoor=0;}
static byte loadArea(byte zone);static byte areaAt(byte x,byte y);

static asm void decompress(){
 asm {
    pshs u,y
    ldx _source
    ldy _unpackTarget
@n  cmpy _length
    bhs @done
    ldb ,x+
    bmi @match
    incb
@l  lda ,x+
    sta ,y+
    decb
    bne @l
    bra @n
@match andb #127
    addb #3
    pshs b
    ldd ,x++
    leau d,y
    puls b
@m  lda ,u+
    sta ,y+
    decb
    bne @m
    bra @n
@done puls y,u,pc
 }
}
static void startLevel(){
 word i;const byte *p=levelObjects;
 
 unpackTarget=GRID;source=packedGrid;length=0xac00+(*(word *)(PACK+4));decompress();
 count=PACK[6];
 for(i=0;i<count;i++){Thing *o=things+i;o->x=*p++;o->y=*p++;o->kind=*p++;o->hp=o->kind==5?12:o->kind>=3?4:2;}
 px=((word)PACK[7]<<8)+128;py=((word)PACK[8]<<8)+128;angle=PACK[9];keys=0;kills=0;
 movingDoor=0;rise=0;for(i=0;i<64;i++)phase[i]=0;cooldown=0;flashTime=0;hurtFlash=0;
}
static byte page;
static byte *blitDest;
static byte blitRows,blitWidth;
static asm void blit(){
 asm {
    pshs u,y
    ldx _source
    ldy _blitDest
@row ldu #0
    ldb _blitWidth
@pixel lda ,y
    anda ,x+
    ora ,x+
    sta ,y+
    decb
    bne @pixel
    ldb #32
    subb _blitWidth
    leay b,y
    dec _blitRows
    bne @row
    puls y,u,pc
 }
}
static void sprite(const byte *shape,byte col0,byte row,byte w,byte h){
 byte j;if(row>=160 || col0+w>32)return;
 source=shape;blitDest=back+((word)row<<5)+col0;blitWidth=w;blitRows=row+h>160?160-row:h;
 for(j=0;j<w;j++)dirtyCols(page)[col0+j]=1;
 blit();
}
static void text(byte x,byte y,const char *s){
 byte *p=back+((word)y<<5)+x;while(*s){word glyph=(word)*s++-32;const byte *g=font+(glyph<<3)+glyph;byte i;for(i=0;i<9;i++)p[(word)i<<5]=g[i];p++;}
}
/* The KEY field of the HUD: one glyph per key slot -- '1' '2' '3' for the keys held and '-' for those not, so a
 * player sees WHICH keys are in hand. It used to print the bitmask as a decimal, so holding keys 1 and 2 showed "3". */
static void keysHud(byte x,byte y,byte k){
 byte i;char one[2];
 for(i=0;i<3;i++){one[0]=(k&(1<<i))?'1'+i:'-';one[1]=0;text(x+i,y,one);}
}
static void number(byte x,byte y,byte n){
 char digits[4];digits[0]='0'+n/100;digits[1]='0'+(n/10)%10;digits[2]='0'+n%10;digits[3]=0;text(x,y,digits);
}
/* Two digits, zero padded: the end screen's clock and kill count, which are two cells wide. number() is fixed at
 * three (the HUD's fields), and its 001 left 00: on the row once the ':' was written over its last column. */
static void twodigits(byte x,byte y,byte n){
 char digits[3];digits[0]='0'+n/10;digits[1]='0'+n%10;digits[2]=0;text(x,y,digits);
}
static const byte *audioPos,*audioEnd;
static void sound(byte i){audioPos=ASSET(i);audioEnd=audioPos+ASSET_LEN(i);}
/* At most four DAC samples per call. Renderer work and input continue while
 * the effect is active. No call holds the CPU for the length of a gunshot. */
asm void audioSlice(){
 asm {
    ldx _audioPos
    beq @done
    ldb #4
@next lda ,x+
    sta $ff20
    lda #7
@delay deca
    bne @delay
    cmpx _audioEnd
    bhs @stop
    decb
    bne @next
    stx _audioPos
    rts
@stop clra
    clrb
    std _audioPos
    lda #128
    sta $ff20
@done rts
 }
}
/* MUS time units are 1/140 second. Render one part on the physical DAC.
 * Read the keys between events so a player can skip the cue. */
static byte musicOn=1,creditsWanted;
static void tune(const byte *score){
 if(!musicOn)return;
 /* IRQ is held for the cue so the field interrupt cannot break up the waveform; FS is polled once a tick (57
  * waves, about 7 ms) at the end of the asm below, so the clock loses no field (clock.h). */
 irqHold();
 while(score[2]){
    word inc=((word)score[0]<<8)+score[1];byte ticks=score[2];score+=3;
    IO(0xff02)=254;if(!(IO(0xff00)&64))break;
    IO(0xff02)=247;if(!(IO(0xff00)&4)){creditsWanted=1;break;}
    while(ticks--){
     asm {
       pshs y,u
       ldx #57
@wave  ldd <$98
       addd :inc
       std <$98
       lsra
       lsra
       adda #96
       sta $ff20
       ldb #15
@wait  decb
       bne @wait
       leax -1,x
       bne @wave
       lda $ff03
       bpl @nofs
       lda $ff02
       lbsr _clockField
@nofs  puls y,u
     }
    }
 }
 IO(0xff20)=128;
 irqRelease();
}
static byte key(byte coln,byte row){IO(0xff02)=~(1<<coln);return !(IO(0xff00)&row);}
static byte *at(byte x,byte y){return GRID+((word)y<<7)+x;}
static byte cross(byte x,byte y,byte nx,byte ny){
 byte *a=at(x,y),*b=at(nx,ny);
 if(*b&16)return 0;
 if(nx!=x)return *a&(nx>x?1:2);
 if(ny!=y)return *a&(ny>y?4:8);
 return 1;
}
static void move(int dir){
 int sx=cosine[angle]*dir,sy=cosine[(angle+24)&31]*dir;
 word x=px+sx,y=py+sy;
 if(cross(px>>8,py>>8,x>>8,py>>8)&&loadArea(areaAt(x>>8,py>>8)))px=x;
 if(cross(px>>8,py>>8,px>>8,y>>8)&&loadArea(areaAt(px>>8,y>>8)))py=y;
}
static void cue(byte finish){
 /* Build the end screen on the page that is NOT on the screen, then flip the SAM to show it, exactly as draw()
  * does at the end of its own body. `back` always holds the hidden page, so the text goes there.
  *
  * Writing to the VISIBLE page was the bug: the beam draws the line while text() is still filling it, so a row
  * came out as "TIM", its last columns landing after that frame's scan. And because cue() never flipped, the
  * finished screen sat on the hidden page while the next draw() showed the other one -- the row was correct in
  * RAM (measured: "TIME 01:03  KILLS 09") and invisible on the screen.
  *
  * Rows are 9 scanlines tall (text() writes 9), so they must be at least 9 apart: the old 72/80/87 spacing had
  * "LEVEL CLEAR" touching the TIME row and "ENTER SKIPS MUSIC" starting inside it. draw() also writes
  * "LEVEL CLEAR. ENTER" at y=76 every frame, 76..84, straight across the old TIME row. The end screen now sits
  * below that band: title 92, time/kills 101, the prompt 110. */
 byte i;   /* `back` is already the hidden page: draw() leaves it pointing away from the screen */
 for(i=96;i<120;i++){byte j;for(j=3;j<29;j++)back[(word)i*32+j]=0;}
 text(7,92,finish?"LEVEL CLEAR":"LEVEL COMPLETE");
 /* The level's time and kills. The time is real PAL fields from the field-sync interrupt (clock.h), stopped by
  * use() the moment the exit is used; mm:ss, minutes held at 99:59 past 99 minutes. The kill count is exact.
  * "TIME mm:ss  KILLS nn" is 20 cells, centred: columns 6..25. */
 if(finish){word secs=clockSeconds;byte mm=99,ss=59;if(secs<6000){mm=(byte)(secs/60);ss=(byte)(secs%60);}
   text(6,101,"TIME");twodigits(11,101,mm);text(13,101,":");twodigits(14,101,ss);
   text(18,101,"KILLS");twodigits(24,101,kills);}
 text(7,110,"ENTER SKIPS MUSIC");
 /* show what was just drawn: draw()'s own flip (bit 3 clears the low page, bit 2 the high one) */
 if(back==(byte*)0xe000){IO(0xffc8)=0;IO(0xffcf)=0;IO(0xffd1)=0;IO(0xffd3)=0;back=(byte*)0x400;}
 else{IO(0xffce)=0;IO(0xffd0)=0;IO(0xffd2)=0;IO(0xffc9)=0;back=(byte*)0xe000;}
 tune(finish?victoryNotes:interNotes);
 for(i=0;i<32;i++){dirtyCols(0)[i]=1;dirtyCols(1)[i]=1;}
}
static void use(){
 byte x=px>>8,y=py>>8;int j;
 for(j=0;j<=3;j++){
 byte nx=(px+cosine[angle]*j*4)>>8,ny=(py+cosine[(angle+24)&31]*j*4)>>8;
 byte *b=at(nx,ny);
 if(*b&32){clockOn=0;won=1;cue(1);return;}
 if(*b&16){byte lock=*b>>6;if(lock && !(keys&(1<<(lock-1))))return;{byte i;if(movingDoor)return;for(i=0;i<PACK[10];i++)if(doorCells[i]==(word)(b-GRID)){movingDoor=doorGroups[i];phase[movingDoor]=1;rise=1;break;}}sound(SND_DOOR);return;}
 if(!cross(x,y,nx,y)||!cross(nx,y,nx,ny))return;
 x=nx;y=ny;
 }
}
static byte target,nearCount;
static asm void findNearby(){
 asm {
    pshs u,y
    ldx #_things
    ldy #$f880
    clr _nearCount
    clrb
@loop cmpb _count
    bhs @done
    tst 2,x
    beq @next
    lda ,x
    suba _px
    adda #18
    cmpa #36
    bhi @next
    lda 1,x
    suba _py
    adda #18
    cmpa #36
    bhi @next
    stb ,y+
    inc _nearCount
@next leax 4,x
    incb
    bra @loop
@done puls y,u,pc
 }
}
static sb tx,ty,tca,tsa;static int tz,th,zoff,hoff;static byte tdepth;
#include "combat.h"
/* MONSTERS AND PICKUPS, SCALED WITH DEPTH. The wall projection is the converter's (buildAtlas screen()):
 * row = 79 - (height - eyes) * 128 / z, z in map units (8 a cell), eyes 5 above the floor. A thing stands on the
 * floor, so its feet are at 79 + 640/z and it is (world height) * 128 / z rows tall; here z is in 1/32 cells
 * (z_map = z/4), so feet = 79 + 2560/z and rows = height * 512/z. The level data has no per-cell floor heights,
 * so the thing's floor is taken as the player's (flat floors; a step between them is not shown).
 *
 * Width follows the art's aspect stretched as the walls are (160 px per unit of horiz/z across, 128 rows down):
 * 7/8 of the height, drawn over the whole bytes that span touches (2..15: never under the asset's own 2, which
 * needs no scaling). Frames are scaled across once into a cache (genFrame) and down at
 * draw time by repeating or skipping source rows (runs[]), one 8-pixel column at a time, so EVERY column gets its
 * own depth test against the walls (rayDistance) and is clipped to the screen on both sides. */
#define runs ((byte*)0x3c8)
static byte aimCol;
static byte *colDest;static const byte *colSrc;
asm void blitColumn(){
 asm {
    pshs u,y
    ldx _colDest
    ldu _colSrc
    ldy #$03c8
@src ldb ,y+
    beq @next
    lda ,u
    beq @solid
    inca
    beq @clear
@px lda ,x
    anda ,u
    ora 1,u
    sta ,x
    leax 32,x
    decb
    bne @px
    bra @next
@solid lda 1,u
@op sta ,x
    leax 32,x
    decb
    bne @op
    bra @next
@clear lda #32
    mul
    leax d,x
@next ldb _gStride
    leau b,u
    cmpy #$03e0
    bne @src
    puls y,u,pc
 }
}
/* Scale one 16x24 mask/ink frame across to gW bytes, row-major as the assets are (2*gW bytes a row), nearest
 * pixel. oM and oK are adjacent (one std stores both). */
static const byte *gSrc;static byte *gDst;static byte gW,gStride,gN,gRows,gCols,gBits,oM,oK;static word gM,gK;
asm void genFrame(){
 asm {
    pshs u,y
    ldx _gDst
    lda #24
    sta _gRows
@row ldu _gSrc
    lda ,u
    ldb 2,u
    std _gM
    lda 1,u
    ldb 3,u
    std _gK
    leau 4,u
    stu _gSrc
    ldb _gN
    lda _gW
    sta _gCols
@col lda #8
    sta _gBits
@bit lda _gM
    rola
    rol _oM
    lda _gK
    rola
    rol _oK
    subb #16
    bgt @keep
@shift lsl _gM+1
    rol _gM
    lsl _gK+1
    rol _gK
    addb _gN
    ble @shift
@keep dec _gBits
    bne @bit
    ldd _oM
    std ,x++
    dec _gCols
    bne @col
    dec _gRows
    bne @row
    puls y,u,pc
 }
}
/* The scaled-frame cache: free RAM above the $E000 screen, below the stack, never written by anything else
 * (measured): the frames at $F9E0-$FCFF, 2*width bytes a row, and their {source, data, width} entries at
 * $F980, ended by a zero source (a cached frame is at least 144 bytes, so at most 5 entries). Width 2 is the asset
 * as it is, never cached. */
#define CACHE ((byte*)0xf9e0)
#define scaledTable ((word*)0xf980)
static byte *cacheTop;static const byte *gFrame;
asm void scaledFrame(){
 asm {
    ldd _gSrc
    std _gFrame
    lda _gW
    cmpa #2
    beq @hit2
    ldx #$f980
@look ldd ,x
    beq @miss
    cmpd _gSrc
    bne @nx
    lda 4,x
    cmpa _gW
    beq @hit
@nx leax 5,x
    bra @look
@hit ldd 2,x
    std _gFrame
@hit2 rts
@miss lda _gW
    ldb #48
    mul
    addd _cacheTop
    cmpd #$fd00
    bls @alloc
    ldd #$f9e0
    std _cacheTop
    ldx #$f980
@alloc ldd _gSrc
    std ,x
    clr 5,x
    clr 6,x
    ldd _cacheTop
    std 2,x
    std _gFrame
    std _gDst
    lda _gW
    sta 4,x
    ldb #48
    mul
    addd _cacheTop
    std _cacheTop
    lda _gW
    lsla
    lsla
    lsla
    sta _gN
    jmp _genFrame
 }
}
/* The pickups' frame: a white pill with a black rim, 16x24 like the monsters'. */
static const byte pickupFrame[96]={248,0,31,0,240,7,15,224,224,15,7,240,192,31,3,248,128,63,1,252,0,127,0,254,0,127,0,254,0,127,0,254,0,127,0,254,0,127,0,254,0,127,0,254,0,127,0,254,0,127,0,254,0,127,0,254,0,127,0,254,0,127,0,254,0,127,0,254,0,127,0,254,0,127,0,254,128,63,1,252,192,31,3,248,224,15,7,240,240,7,15,224,248,0,31,0};
/* runs[s]: how many screen rows source row s covers, rows clipped to 0..159. Every source row covers floor(acc/24)
 * rows as acc steps by the height; yy is the row + 8 (the top is never above -5), so the clip is 8..167. */
static byte dH,yy,acc,cc,cnt,colHit,depthNow,cOff;static sb c0;static byte *dBase;
asm void makeRuns(){
 asm {
    ldx #$03c8
    clr _acc
@s  lda _acc
    adda _dH
    clrb
@q  cmpa #24
    blo @d
    suba #24
    pshs a
    lda _yy
    inc _yy
    cmpa #8
    blo @o
    cmpa #168
    bhs @o
    incb
@o  puls a
    bra @q
@d  sta _acc
    stb ,x+
    cmpx #$03e0
    bne @s
    rts
 }
}
/* Columns c0..c0+gW-1 of the frame: each one on the screen and not behind a nearer wall is drawn and marked
 * dirty; colHit gets 2 for any column drawn, 3 if one is in the aim window 13..19. The row runs and the scaled
 * frame are made at the first column that is drawn (colHit still 0), so a thing wholly behind walls costs neither. */
static asm void drawColumns(){
 asm {
    clr _colHit
    clr _cOff
    lda _gW
    lsla
    sta _gStride
    ldb _c0
    stb _cc
    lda _gW
    sta _cnt
@col ldb _cc
    cmpb #31
    bhi @skip
    ldx #_rayDistance
    lda b,x
    inca
    cmpa _depthNow
    blo @skip
    tst _colHit
    bne @made
    jsr _makeRuns
    jsr _scaledFrame
@made ldb _cc
    ldx _dBase
    abx
    stx _colDest
    ldx _gFrame
    ldb _cOff
    abx
    stx _colSrc
    jsr _blitColumn
    ldx #$f8c0
    tst _page
    beq @p0
    leax 32,x
@p0 ldb _cc
    lda #1
    sta b,x
    inca
    subb #13
    cmpb #6
    bhi @nh
    inca
@nh ora _colHit
    sta _colHit
@skip inc _cOff
    inc _cOff
    inc _cc
    dec _cnt
    bne @col
    rts
 }
}
/* The thing's place in the view: tz = tx*tca + ty*tsa (+ zoff), th = tx*tsa - ty*tca (+ hoff), tdepth = the
 * cell-centre depth (tx*tca+ty*tsa+3)>>3, at least 0. Signed 8x8 products in asm: CMOC multiplies two signed
 * chars into a CHAR (its MUL keeps only B), which loses everything past 127. */
static asm void project(){
 asm {
    lda _tx
    ldb _tca
    bsr @smul
    std _tz
    lda _ty
    ldb _tsa
    bsr @smul
    addd _tz
    bpl @pos
    clr _tdepth
    bra @dz
@pos pshs d
    addd #3
    lsra
    rorb
    lsra
    rorb
    lsra
    rorb
    stb _tdepth
    puls d
@dz addd _zoff
    std _tz
    lda _tx
    ldb _tsa
    bsr @smul
    addd _hoff
    std _th
    lda _ty
    ldb _tca
    bsr @smul
    pshs d
    ldd _th
    subd ,s++
    std _th
    rts
@smul pshs d
    mul
    tst ,s
    bpl @s1
    suba 1,s
@s1 tst 1,s
    bpl @s2
    suba ,s
@s2 leas 2,s
    rts
 }
}
/* Draw a thing hw2/2 map units tall at (th, tz) (1/32 cells), occluded per column by walls nearer than tdepth.
 * Returns 0 if nothing was drawn, 2 if drawn, 3 if drawn with a column in the aim window (13..19). */
static byte drawScaled(const byte *shape,byte hw2){
 /* One division a thing: inv = 65535/tz (tz >= 18, so inv <= 3640). Height hw*512/tz = inv*(2*hw)/256, floor
  * line 79 + 2560/tz = 79 + inv*10/256. */
 word inv=65535u/(word)tz,a;byte h=(byte)((inv*hw2)>>8),wpx=h-(h>>3),top;int left;
 yy=(byte)(88+((inv*10)>>8))-h;top=yy<8?0:yy-8;dH=h;
 /* Centre pixel 128 + 160*th/tz: 128*|th|/tz = (|th|/2)*inv/256 (|th| <= 1.25 tz keeps the product in a word),
  * plus a quarter of it. The frame covers every byte column its true span [left, left+wpx) touches, so a column
  * holds sprite exactly where the thing is. */
 a=((word)((th<0?-th:th)>>1)*inv)>>8;a+=a>>2;left=th<0?128-(int)a:128+(int)a;aimCol=(byte)(left>>3);left-=wpx>>1;
 c0=(sb)(((left+256)>>3)-32);gW=(byte)(((left+wpx+255)>>3)-31-c0);
 if((sb)gW<2)gW=2;if(gW>15)gW=15;
 if(c0>31||c0+(sb)gW<=0)return 0;
 dBase=back+(word)top*32;gSrc=shape;depthNow=tdepth;drawColumns();
 return colHit;
}
static void actors(){
 byte i,n,k,kd;int near=127;
 /* the player's offset from the cell centre, in 1/16 cells, turned into the view: tz and th are then the
  * cell-centre values plus these (exactly: 16*zc+zoff >> 4 = zc + (zoff>>4)) */
 tca=cosine[angle];tsa=cosine[(angle+24)&31];
 tx=8-((byte)px>>4);ty=8-((byte)py>>4);zoff=0;hoff=0;project();zoff=tz>>4;hoff=th>>4;
 target=255;
 for(n=0;n<nearCount;n++){
    i=nearby[n];aimColumn[i]=255;
    Thing *o=things+i;
    kd=o->kind;if(!kd)continue;
    /* findNearby keeps every thing here within 18 cells on each axis */
    tx=o->x-(byte)(px>>8);ty=o->y-(byte)(py>>8);
    if(kd>=6 && !tx && !ty){
       if(kd==6)ammo=ammo>180?200:ammo+20;
       if(kd==7)health=health>75?100:health+25;
       if(kd==8){gun=1;ownedShotgun=1;shells=shells>46?50:shells+4;}
       if(kd>=9&&kd<=11)keys|=1<<(kd-9);
       if(kd==12)shells=shells>46?50:shells+4;
       if(kd==13)armor=100;
       if(kd==14 && health<200)health++;
       if(kd==15 && armor<200)armor++;
       o->kind=0;sound(SND_PICKUP);continue;
    }
    /* Occlusion depth from the CELL CENTRE, which is where rayDistance is measured from (the view tables are per
     * cell); projection from the player's true position, as the blended walls are. */
    project();if(tz<18)continue;
    if(th>tz+(tz>>2)||th< -tz-(tz>>2))continue;
    /* pickups 2 map units tall, monsters 7 (the boss 8) */
    if(kd>=6){drawScaled(pickupFrame,2*2);continue;}
    k=drawScaled(kd==5?boss:wind[i]?impCast:kd>=3?imp:guard,kd==5?8*2:7*2);
    if(!k)continue;
    if(k==3&&tz<near*32){target=i;targetDepth=tdepth;near=(tz+31)>>5;}
    aimColumn[i]=aimCol;aimDepth[i]=tdepth;
 }
}
static byte oldHP[2],oldAmmo[2],oldKeys[2],oldLevel[2],valid[2];
#include "floppy.h"
#include "scene.h"
static void draw(){
 byte i;scene();
 actors();missiles();sprite(gun==2?fist:flashTime?flash:gun?shotgun:weapon,14,124,5,36);
 i=(back==(byte*)0xe000);
 if(!valid[i]){
   byte j;for(j=0;j<32;j++)back[5120+j]=255;
   text(1,164,"AMMO");text(9,164,"HEALTH");text(19,164,"KEY");text(25,164,"MAP");
 }
 {byte readyAmmo=gun==2?0:gun?shells:ammo;if(!valid[i]||readyAmmo!=oldAmmo[i]){number(1,177,readyAmmo);oldAmmo[i]=readyAmmo;}}
 if(!valid[i]||health!=oldHP[i]){byte y;const byte *f=health<45?wounded:marine;byte *d=back+32*163+16;
    number(9,177,health);for(y=0;y<25;y++){d[0]=*f++;d[1]=*f++;d[2]=*f++;d+=32;}oldHP[i]=health;}
 if(!valid[i]||keys!=oldKeys[i]){keysHud(19,177,keys);oldKeys[i]=keys;}
 if(!valid[i]||level!=oldLevel[i]){number(25,177,level+1);oldLevel[i]=level;}
 valid[i]=1;
 if(!health){text(6,76,"YOU DIED. ENTER RETRIES");for(i=0;i<32;i++)dirtyCols(page)[i]=1;}
 if(won){text(5,76,"LEVEL CLEAR. ENTER");for(i=0;i<32;i++)dirtyCols(page)[i]=1;}
 /* ONE-PICTURE BORDER FLASH when a hit lands: the VDG's colour set is inverted for the frame the hit is drawn in
  * (CSS, $FF22 bit 3, which the engine leaves set to 1), then put back on the next draw. No memory moves, so it
  * costs the player nothing; hurtFlash is set by hurt() and counted down once a frame. */
 /* CSS is bit 3 of PIA1 port B. It must be an OUTPUT for this store to reach the VDG: the engine sets DDRB=$38
  * at startup for exactly that, then narrows it to $3C, and both leave bit 3 an output. The bit is DRIVEN here on
  * every picture -- set to 1 normally, cleared for the flash -- rather than or-ed, because the loop leaves ORB at
  * $F9 (CSS clear) and an or-only version cleared a bit that was already clear, so the flash never showed. */
 if(hurtFlash){IO(0xff22)&=247;}else{IO(0xff22)|=8;}
 if(back==(byte*)0xe000){IO(0xffc8)=0;IO(0xffcf)=0;IO(0xffd1)=0;IO(0xffd3)=0;back=(byte*)0x400;}
 else{IO(0xffce)=0;IO(0xffd0)=0;IO(0xffd2)=0;IO(0xffc9)=0;back=(byte*)0xe000;}
 IO(0x200)++;IO(0x201)=angle;IO(0x202)=px>>8;IO(0x203)=py>>8;IO(0x204)=health;IO(0x205)=ammo;IO(0x206)=level;IO(0x207)=kills;
}
static void clearScreen(byte *p){
 word i;for(i=0;i<6144;i++)p[i]=0;
}
/* Read and verify the HGA1 asset block. */
static byte loadAssets(){
 word n,sum;const byte *p;
 if(!diskRead(ASSET_SECTOR,ASSET_SECTORS,ASSETS))return 0;
 if(ASSETS[0]!=72||ASSETS[1]!=71||ASSETS[2]!=65||ASSETS[3]!=49)return 0;
 n=*(word *)(ASSETS+4);if(n>ASSET_BYTES||n<8+4*ASSET_COUNT)return 0;
 sum=0;for(p=ASSETS+8;p!=ASSETS+n;p++)sum+=*p;
 return sum==*(word *)(ASSETS+6);
}
/* The credits screen, from the title with C: the level disk's own credit lines (CREDITS entry of the asset
 * block, written by the converter for the WAD it came from), then the engine's. Rows are 9 scanlines; 12 apart. */
static void credits(){
 const byte *p=ASSET(CREDITS),*end=p+ASSET_LEN(CREDITS);byte y=64,n;
 clearScreen(back);text(12,40,"CREDITS");
 while(p<end){n=0;while(p[n])n++;text((32-n)>>1,y,(const char*)p);p+=n+1;y+=12;}
 y+=12;text(7,y,"WYRMFIRE  GPL-3.0");text(0,y+12,"NOT AFFILIATED WITH ID SOFTWARE");
 text(8,160,"ENTER CONTINUES");
 while(!key(0,64)){}while(key(0,64)){}
}
static void waitForDisk(){text(4,82,"INSERT LEVEL DISK / ENTER");while(!key(0,64)){}}
static void readLevel(){
 byte j;
 currentArea=0;
 for(j=0;j<MAX_OBJECTS;j++){wind[j]=0;waitForAttack[j]=0;}
 for(j=0;j<4;j++)balls[j].life=0;
 while(!loadAssets())waitForDisk();
 while(!diskRead(PACK_SECTOR,PACK_SECTORS,PACK)||PACK[0]!=72||PACK[1]!=71||PACK[2]!=82||PACK[3]!=50)waitForDisk();
 startLevel();*scaledTable=0;cacheTop=CACHE;
 while(!loadArea(areaAt(px>>8,py>>8)))waitForDisk();
 clockStart();
 }
int main(){
 byte i,wasUse=0,wasD=0;
 IO(0xff23)=0x38;IO(0xff22)|=248;IO(0xff23)=0x3c;IO(0xff22)|=248;
 IO(0xff21)=0x30;IO(0xff20)=0xfc;IO(0xff21)=0x34;IO(0xff20)=128;
 IO(0xffc1)=0;IO(0xffc3)=0;IO(0xffc5)=0;IO(0xffc6)=0;IO(0xffc9)=0;
 IO(0xffca)=0;IO(0xffcc)=0;IO(0xffce)=0;IO(0xffd0)=0;IO(0xffd2)=0;
 IO(0xff03)=0x30;IO(0xff02)=255;IO(0xff03)=0x34;IO(0xff01)=0x30;IO(0xff00)=0;IO(0xff01)=0x34;
 installClock();
 clearSignatures();
 clearScreen((byte*)0x400);clearScreen((byte*)0xe000);back=(byte*)0xe000;
 health=100;ammo=50;
 back=(byte*)0x400;text(8,82,"READING LEVEL DISK");
 while(!loadAssets())waitForDisk();
 clearScreen(back);text(12,74,"WYRMFIRE");text(8,92,"ENTER SKIPS MUSIC");text(11,110,"C CREDITS");tune(introNotes);
 if(creditsWanted||key(3,4))credits();
 clearScreen(back);text(8,82,"READING LEVEL DISK");
 readLevel();
 clearScreen(back);back=(byte*)0xe000;
 for(;;){
    byte useNow=key(5,4),dKey=key(4,4);if(dKey&&!wasD)shading=!shading;wasD=dKey;turn++;
    if(won||!health){if(key(0,64)){if(won)level=0;won=0;gun=0;armor=0;shells=0;ownedShotgun=0;health=100;ammo=50;readLevel();}}
    else{
      if(key(5,32))angle=(angle+1)&31;if(key(6,32))angle=(angle+31)&31;
      if(key(1,1))gun=2;if(key(2,1)&&ammo)gun=0;if(key(3,1)&&shells&&ownedShotgun)gun=1;
      if(key(2,32)||key(0,32)){byte old=angle;angle=(angle+(key(2,32)?8:24))&31;move(2);angle=old;}
      if(key(3,32))move(2);if(key(4,32))move(-2);
      animateDoor();
      if(useNow&&!wasUse)use();
      if(flashTime)flashTime--;if(cooldown)cooldown--;if(hurtFlash)hurtFlash--;
    }
    wasUse=useNow;if(health&&!won)simulate();draw();
    if(health&&!won&&key(7,32)&&!cooldown){
       if(gun==1&&!shells)gun=ammo?0:2;
       if(!gun&&!ammo)gun=ownedShotgun&&shells?1:2;
       if(!gun)ammo--;if(gun==1)shells--;
       flashTime=2;cooldown=gun==1?4:3;
       if(gun==1)shotgunAttack();
       else if(target!=255 && (gun!=2||targetDepth<=7)){
          Thing *t=things+target;byte damage=gun==1?4:2;
          if(t->hp<=damage){t->kind=t->kind==1?6:t->kind==2?8:0;kills++;}else t->hp-=damage;
       }
       if(gun==0)sound(SND_FIRE);
       else if(gun==1)sound(SND_BLAST);
    }
 }
 return 0;
}
