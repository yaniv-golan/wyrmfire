/* Drive 1 (WD2797), double density, 18 sectors per side. Poll DRQ in direct
 * page FF; the user may retry a missing or wrong disk without losing the game. */
static byte diskTrack=255,diskSide,diskSector,diskError;
static byte *transfer,*transferEnd;
static asm void readTrackPart(){
 asm {
   pshs dp,u,y
   lda #$ff
   tfr a,dp
   ldx _transfer
   ldu _transferEnd
   stu @cmp+1,pcr
   lda _diskSector
   sta <$42
   ldb #12
@settle decb
   bne @settle
   lda _diskSide
   ora #$98
   sta <$40
   ldb #12
@delay decb
   bne @delay
   ldb #2
@wait lda <$40
   bita #2
   bne @d0
   anda #5
   cmpa #1
   beq @wait
   bita #2
   bne @d0
   lbra @bad
@d0
   lda <$43
   sta ,x+
@w1 bitb <$40
   beq @w1
   lda <$43
   sta ,x+
@w2 bitb <$40
   beq @w2
   lda <$43
   sta ,x+
@w3 bitb <$40
   beq @w3
   lda <$43
   sta ,x+
@w4 bitb <$40
   beq @w4
   lda <$43
   sta ,x+
@w5 bitb <$40
   beq @w5
   lda <$43
   sta ,x+
@w6 bitb <$40
   beq @w6
   lda <$43
   sta ,x+
@w7 bitb <$40
   beq @w7
   lda <$43
   sta ,x+
@w8 bitb <$40
   beq @w8
   lda <$43
   sta ,x+
@w9 bitb <$40
   beq @w9
   lda <$43
   sta ,x+
@w10 bitb <$40
   beq @w10
   lda <$43
   sta ,x+
@w11 bitb <$40
   beq @w11
   lda <$43
   sta ,x+
@w12 bitb <$40
   beq @w12
   lda <$43
   sta ,x+
@w13 bitb <$40
   beq @w13
   lda <$43
   sta ,x+
@w14 bitb <$40
   beq @w14
   lda <$43
   sta ,x+
@w15 bitb <$40
   beq @w15
   lda <$43
   sta ,x+
@cmp cmpx #$ffff
   lblo @wait
   lda #$d0
   sta <$40
   ldb #12
@finish decb
   bne @finish
   lda <$40
   anda #$1c
   sta _diskError
   lbra @end
@slow lda <$40
   bita #2
   bne @ok
   bita #1
   beq @abort
   bita #4
   beq @slow
@abort leas 2,s
@bad ora #$80
   sta _diskError
   lda #$d0
   sta <$40
@end puls y,u,dp,pc
@ok rts

 }
}
static byte seekTrack(byte t){
 word timeout;byte status;
 if(diskTrack==t)return 1;
 IO(0xff48)=4;
 if(diskTrack==255){
    IO(0xff40)=3;
    asm { nop
          nop
          nop }
    timeout=65535;while((IO(0xff40)&1)&&--timeout){}
    if(!timeout)return 0;
 }
 IO(0xff43)=t;
 asm { nop
       nop
       nop }
 IO(0xff40)=0x13;
 asm { nop
       nop
       nop }
 timeout=65535;while(((status=IO(0xff40))&1)&&--timeout){}
 if(!timeout||(status&0x10))return 0;
 diskTrack=t;return 1;
}
static byte diskRead(word sector,byte n,byte *buf){
 while(n){
    byte cylinder=sector/36,within=sector%36,side=within>=18;
    byte first=within%18,take=18-first;
    if(take>n)take=n;
    if(!seekTrack(cylinder))return 0;
    diskSide=side?2:0;diskSector=first+1;transfer=buf;
    transferEnd=buf+((word)take<<8);
    readTrackPart();if(diskError){diskTrack=255;return 0;}
    buf=transferEnd;sector+=take;n-=take;
 }
 return 1;
}
