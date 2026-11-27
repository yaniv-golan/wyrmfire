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
/* markOne: rows mTop..mEnd-1 of the column whose entry is X were drawn over. */
asm void markOne(){
 asm {
    lda ,x
    bne @merge
    lda _mTop
    sta -64,x
    lda _mEnd
    sta ,x
    rts
@merge lda _mTop
    cmpa -64,x
    bhs @m1
    sta -64,x
@m1 lda _mEnd
    cmpa ,x
    bls @m2
    sta ,x
@m2 rts
 }
}
/* markCols: the same for B columns from column A of the page being drawn. */
asm void markCols(){
 asm {
    ldx _dirtBase
    leax a,x
@c  pshs b
    jsr _markOne
    puls b
    leax 1,x
    decb
    bne @c
    rts
 }
}
/* paint1: rows A..B (inclusive, A<=B) of the current column get what the wall band newSig[0..1] with ink newSig[4]
 * puts there on an empty column: 0 above the top row, $FF on it, the ink between, $FF on the bottom row, 0 below
 * (all 0 when the band is empty). The portal band goes over it afterwards (band()). Keeps Y and U.
 * pN counts the rows still to paint; X walks down the column. */
static byte pRow,pN;
asm void paint1(){
 asm {
    sta _pRow
    subb _pRow
    incb
    stb _pN
    jsr _rowAt
    lda _newSig+1
    cmpa _newSig
    bls @zero
    lda _newSig
    suba _pRow
    beq @atA
    bcs @past
    cmpa _pN
    bhs @zero
    tfr a,b
    nega
    adda _pN
    sta _pN
    clra
    jsr _fillRows
@atA lda #255
    sta ,x
    leax 32,x
    dec _pN
    beq @done
    lda _newSig
    inca
    bra @inside
@past lda _pRow
    cmpa _newSig+1
    bhi @zero
@inside nega
    adda _newSig+1
    beq @atB
    cmpa _pN
    blo @i1
    lda _pN
@i1 tfr a,b
    nega
    adda _pN
    sta _pN
    lda _newSig+4
    jsr _fillRows
    tst _pN
    beq @done
@atB lda #255
    sta ,x
    leax 32,x
    dec _pN
    beq @done
@zero ldb _pN
    clra
    jmp _fillRows
@done rts
 }
}
/* paintRow: the same for the single row A. */
asm void paintRow(){
 asm {
    pshs a
    jsr _rowAt
    puls a
    ldb _newSig+1
    cmpb _newSig
    bls @zero
    cmpa _newSig
    blo @zero
    beq @ff
    cmpa _newSig+1
    bhi @zero
    beq @ff
    lda _newSig+4
    sta ,x
    rts
@ff lda #255
    sta ,x
    rts
@zero clr ,x
    rts
 }
}
/* paintBand: every row a band A..B (top, bottom) with ink bandInk writes on: all of them when the ink is not 0,
 * else the two edge rows. Nothing if B<=A. */
asm void paintBand(){
 asm {
    pshs b
    cmpa ,s
    bhs @out
    tst _bandInk
    beq @edges
    leas 1,s
    jmp _paint1
@edges jsr _paintRow
    lda ,s
    jsr _paintRow
@out puls b,pc
 }
}
/* paintBetween: paint1 over the rows from A to B, whichever is the larger; nothing when they are equal. */
asm void paintBetween(){
 asm {
    pshs b
    cmpa ,s+
    beq @r
    blo @go
    exg a,b
@go jmp _paint1
@r  rts
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
    epoch++;
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
static void clearSignatures(){
 asm {
    ldx #$0208
@z  clr ,x+
    cmpx #$03fe
    bne @z
    ldx #$fe00
@d  clr ,x+
    cmpx #$fec0
    bne @d
 }
}
static const byte *view,*adjacent;
/* The still view. The 32 columns are a function of the view entries, the blend, the heading, the hatching and
 * the door phases: {view, adjacent} and {blendWeight, shading, start, epoch} (epoch counts every change to the
 * view tables in AREA and to phase[]). When all of that is what the last pass used (lastView, lastKey) and this
 * page's signatures were made from it (fresh[page]), every column's signature and rayDistance[] are already
 * right, and a column is visited only for what a sprite left on it. */
static const byte *lastView,*lastAdjacent;static byte lastKey[4],fresh[2],fast;
static byte newDist,lift,touched,wNow,wHurt;static byte *dirtAt;
/* The 32 wall columns of the picture. For each: four DAC samples (audioSlice), the view table's entry for the
 * column's ray (blended with the adjacent cell's when there is one: value + (other-value)*blendWeight/256,
 * rounded), the door lift, then the six-byte signature {top, bottom, portal top, portal bottom, ink, portal ink}.
 * A column whose signature is the one on this page and that no sprite touched is left alone. Otherwise only the
 * rows that differ are painted, each with what the new wall band puts there (paint1, paintRow): the rows a sprite
 * or a text drew over (dirt); for a wall band that changed, the rows between its old and its new edges when it is
 * filled, kept its ink and still overlaps itself, the rows from the higher top to the lower bottom when both are
 * filled and overlap, and otherwise every row the old band and the new one write on (all of a filled band, the
 * two edge rows of a hollow one); the rows a portal band that changed wrote on. Then the portal band is drawn
 * over the wall band again. The result is what
 * clearing the column and drawing both bands gives. The weapon's frame stays on its column (dirt[128+..]) unless a
 * signature changed, rows from 124 down were repainted or the portal band reaches them (wHurt). maxRay is the
 * farthest wall of the picture: a thing deeper than maxRay+1 is behind every column. Y = the page's signature for the column, U = the view entry. */
asm void columns(){
 asm {
    pshs u,y
    ldy #$0208
    tst _page
    beq @p0
    leay 192,y
@p0 clr _fast
    ldx #_fresh
    ldb _page
    abx
    ldu _view
    cmpu _lastView
    bne @new
    ldu _adjacent
    cmpu _lastAdjacent
    bne @new
    ldd _blendWeight
    cmpd _lastKey
    bne @new
    ldd _start
    cmpd _lastKey+2
    bne @new
    lda ,x
    sta _fast
    bra @key
@new ldu _view
    stu _lastView
    ldu _adjacent
    stu _lastAdjacent
    ldd _blendWeight
    std _lastKey
    ldd _start
    std _lastKey+2
    clr _fresh
    clr _fresh+1
@key lda #1
    sta ,x
    tst _fast
    bne @c0
    clr _maxRay
@c0 clr _col
@col jsr _audioSlice
    tst _fast
    beq @full
    ldx _dirtBase
    ldb _col
    abx
    lda 64,x
    beq @f1
    cmpa _wNow
    bne @f2
@f1 tst ,x
    lbeq @next
@f2 ldd ,y
    std _newSig
    ldd 2,y
    std _newSig+2
    ldd 4,y
    std _newSig+4
    lbra @merge
@full
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
    cmpa _maxRay
    bls @merge
    sta _maxRay
@merge ldx _dirtBase
    ldb _col
    abx
    stx _dirtAt
    clr _touched
    clr _wHurt
    lda 64,x
    beq @w0
    cmpa _wNow
    beq @w0
    inc _touched
    inc _wHurt
    ldd #$7c9f
    jsr _paint1
@w0 ldd _newSig
    cmpd ,y
    bne @chg1
    lda _newSig+4
    cmpa 4,y
    lbeq @b2
@chg1 inc _touched
    inc _wHurt
    lda 4,y
    beq @each
    cmpa _newSig+4
    bne @solid
    sta _bandInk
    lda 1,y
    cmpa ,y
    bls @each
    lda _newSig+1
    cmpa _newSig
    bls @each
    bsr @lap
    bls @each
    lda ,y
    ldb _newSig
    jsr _paintBetween
    lda 1,y
    ldb _newSig+1
    jsr _paintBetween
    bra @b2
@solid tst _newSig+4
    beq @each
    lda 1,y
    cmpa ,y
    bls @each
    lda _newSig+1
    cmpa _newSig
    bls @each
    bsr @lap
    bls @each
    lda ,y
    cmpa _newSig
    bls @wl
    lda _newSig
@wl ldb 1,y
    cmpb _newSig+1
    bhs @wh
    ldb _newSig+1
@wh jsr _paint1
    bra @b2
@lap lda ,y
    cmpa _newSig
    bhs @mx
    lda _newSig
@mx sta _lift
    ldb 1,y
    cmpb _newSig+1
    bls @mn
    ldb _newSig+1
@mn cmpb _lift
    rts
@each lda 4,y
    sta _bandInk
    ldd ,y
    jsr _paintBand
    lda _newSig+4
    sta _bandInk
    ldd _newSig
    jsr _paintBand
@b2 ldd _newSig+2
    cmpd 2,y
    bne @chg2
    lda _newSig+5
    cmpa 5,y
    beq @dirt
@chg2 inc _touched
    inc _wHurt
    lda 5,y
    sta _bandInk
    ldd 2,y
    jsr _paintBand
@dirt ldx _dirtAt
    ldb ,x
    beq @fin
    inc _touched
    clr ,x
    cmpb #124
    bls @d1
    inc _wHurt
@d1 decb
    lda -64,x
    pshs a
    cmpb ,s+
    blo @fin
    jsr _paint1
@fin tst _touched
    beq @next
    ldd _newSig
    std ,y
    ldd _newSig+4
    std 4,y
    stb _bandInk
    ldd _newSig+2
    std 2,y
    cmpb #124
    blo @f8
    pshs a
    cmpb ,s+
    bls @f8
    inc _wHurt
@f8 tst _wHurt
    beq @f9
    ldx _dirtAt
    clr 64,x
@f9 ldd 2,y
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
 /* the player's distance from the cell centre on each axis, 0..128; the larger one picks the neighbour to blend with */
 byte x=px>>8,y=py>>8,otherX=x,otherY=y,fx=(byte)px,fy=(byte)py,ax=fx<128?128-fx:fx-128,ay=fy<128?128-fy:fy-128;
 start=angle*3;
 page=0;dirtBase=DIRT+64;if(back==(byte*)0xe000){page=1;dirtBase=DIRT+96;}
 if(!loadArea(areaAt(x,y)))return;
 view=viewAt(x,y);if(!view)return;
 if(ax>ay){if(fx<128)otherX--;else otherX++;blendWeight=ax;}
 else{if(fy<128)otherY--;else otherY++;blendWeight=ay;}
 adjacent=0;
 if(blendWeight>8&&areaAt(otherX,otherY)==currentArea&&cross(x,y,otherX,otherY))adjacent=viewAt(otherX,otherY);
 columns();
}
