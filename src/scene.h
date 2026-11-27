/* The wall columns' drawing primitives, in assembly. A column is 160 rows, 32 bytes apart.
 * rowAt: X = back + 32*A + col (row A of the current column); uses D. */
static byte col;
asm void rowAt(){
 asm {
    ldb #32
    mul
    addd _back
    addb _col
    adca #0
    tfr d,x
    rts
 }
}
/* fillRows: store A in B rows from X down the column (B may be 0); X ends on the row after the last. */
asm void fillRows(){
 asm {
    pshs b
    lsrb
    lsrb
    lsrb
    beq @tail
@eight sta ,x
    sta 32,x
    sta 64,x
    sta 96,x
    leax 128,x
    sta ,x
    sta 32,x
    sta 64,x
    sta 96,x
    leax 128,x
    decb
    bne @eight
@tail puls b
    andb #7
    beq @end
@one sta ,x
    leax 32,x
    decb
    bne @one
@end rts
 }
}
/* A band: $FF on rows A (top) and B (bottom), bandInk on the rows between when it is not 0. Nothing if B<=A. */
static byte bandInk;
asm void band(){
 asm {
    pshs b,a
    cmpb ,s
    bls @out
    jsr _rowAt
    lda #255
    sta ,x
    ldb 1,s
    subb ,s
    lda _bandInk
    beq @hollow
    leax 32,x
    decb
    jsr _fillRows
    bra @last
@hollow lda #32
    mul
    leax d,x
@last lda #255
    sta ,x
@out puls a,b,pc
 }
}
/* Take a band off: rows A..B to 0 when bandInk is not 0, else only the two edge rows. Nothing if B<=A. */
asm void eraseBand(){
 asm {
    pshs b,a
    cmpb ,s
    bls @out
    jsr _rowAt
    ldb 1,s
    subb ,s
    tst _bandInk
    beq @two
    incb
    clra
    jsr _fillRows
    bra @out
@two clr ,x
    lda #32
    mul
    leax d,x
    clr ,x
@out puls a,b,pc
 }
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
 * it before the first picture (clearSignatures), together with the door phases and the sprite row runs above it
 * ($0388-$03DF, native.c): 502 bytes in all. */
#define SIGNATURES ((byte*)0x208)
static void clearSignatures(){word i;for(i=0;i<502;i++)SIGNATURES[i]=0;}
static const byte *view,*adjacent;
static byte blendWeight,shading;
static byte start,newSig[6],newDist,lift;static byte *dirtyPtr;
asm void clearColumn(){
 asm {
    clra
    ldb #20
@loop
    sta 0,x
    sta 32,x
    sta 64,x
    sta 96,x
    leax 128,x
    sta 0,x
    sta 32,x
    sta 64,x
    sta 96,x
    leax 128,x
    decb
    bne @loop
    rts
 }
}
/* The 32 wall columns of the picture. For each: four DAC samples (audioSlice), the view table's entry for the
 * column's ray (blended with the adjacent cell's when there is one: value + (other-value)*blendWeight/256,
 * rounded), the door lift, then the six-byte signature {top, bottom, portal top, portal bottom, ink, portal ink}.
 * A column whose signature is the one on this page and that no sprite touched is left alone. Y = the page's
 * signature for the column, U = the view entry. */
asm void columns(){
 asm {
    pshs u,y
    ldy #$0208
    ldx #$f8c0
    tst _page
    beq @p0
    leay 192,y
    leax 32,x
@p0 stx _dirtyPtr
    clr _col
@col jsr _audioSlice
    ldb _col
    ldx #_rayOffset
    lda b,x
    adda _start
    bpl @k1
    adda #96
@k1 cmpa #96
    blo @k2
    suba #96
@k2 ldu _view
    leau a,u
    ldx _adjacent
    lbeq @copy
    leax a,x
    lda ,x
    suba ,u
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
@save0 adda ,u
    sta _newSig
    lda 96,x
    suba 96,u
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
@save1 adda 96,u
    sta _newSig+1
    lda 192,x
    suba 192,u
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
@save2 adda 192,u
    sta _newSig+2
    lda 288,x
    suba 288,u
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
@save3 adda 288,u
    sta _newSig+3
    bra @have
@copy lda ,u
    ldb 96,u
    std _newSig
    lda 192,u
    ldb 288,u
    std _newSig+2
@have lda 384,u
    sta _newDist
    ldb 576,u
    beq @none
    cmpb #1
    beq @plain
    ldx #$0387
    lda b,x
    cmpa #8
    blo @lift
    clr _newSig+2
    clr _newSig+3
    bra @door
@lift sta _lift
    ldb _newSig+3
    subb _newSig+2
    mul
    lsra
    rorb
    lsra
    rorb
    lsra
    rorb
    negb
    addb _newSig+3
    stb _newSig+3
    lda _lift
    cmpa #6
    bhs @door
    lda 480,u
    sta _newDist
@door lda #$99
    bra @edge
@none clr _newSig+2
    clr _newSig+3
@plain lda 672,u
    anda #4
    beq @edge
    lda #$80
@edge sta _newSig+5
    lda 672,u
    bita #2
    beq @i1
    lda #$80
    bra @ink
@i1 anda #1
    beq @i2
    lda #$ff
    bra @ink
@i2 tst _shading
    beq @ink
    lda #$11
@ink sta _newSig+4
    ldb _col
    ldx #_rayDistance
    lda _newDist
    sta b,x
    ldx _dirtyPtr
    abx
    tst ,x
    bne @clear
    ldd _newSig
    cmpd ,y
    bne @changed
    ldd _newSig+2
    cmpd 2,y
    bne @changed
    ldd _newSig+4
    cmpd 4,y
    beq @next
@changed lda 4,y
    ora 5,y
    beq @erase
    lda 1,y
    suba ,y
    cmpa #56
    bls @erase
@clear clr ,x
    ldd _back
    addb _col
    adca #0
    tfr d,x
    jsr _clearColumn
    bra @draw
@erase lda 4,y
    sta _bandInk
    ldd ,y
    jsr _eraseBand
    lda 5,y
    sta _bandInk
    ldd 2,y
    jsr _eraseBand
@draw ldd _newSig+4
    std 4,y
    sta _bandInk
    ldd _newSig
    std ,y
    jsr _band
    lda 5,y
    sta _bandInk
    ldd _newSig+2
    std 2,y
    jsr _band
@next leay 6,y
    inc _col
    lda _col
    cmpa #32
    lbne @col
    puls y,u,pc
 }
}
static void scene(){
 byte x=px>>8,y=py>>8,otherX=x,otherY=y;
 int dx=(int)(byte)px-128,dy=(int)(byte)py-128;
 start=angle*3;
 page=back==(byte*)0xe000;
 if(!loadArea(areaAt(x,y)))return;
 view=viewAt(x,y);if(!view)return;
 if(dx<0? -dx>(dy<0?-dy:dy):dx>(dy<0?-dy:dy)){otherX+=dx<0?-1:1;blendWeight=dx<0?-dx:dx;}
 else{otherY+=dy<0?-1:1;blendWeight=dy<0?-dy:dy;}
 adjacent=0;
 if(blendWeight>8&&areaAt(otherX,otherY)==currentArea&&cross(x,y,otherX,otherY))adjacent=viewAt(otherX,otherY);
 columns();
}
