/* Drive 1 (WD2797), double density, 18 sectors per side. Poll DRQ in direct
 * page FF; the user may retry a missing or wrong disk without losing the game. */
static byte diskTrack=255,diskSide,diskSector,diskError;
static byte *transfer,*transferEnd;
/* IRQ is masked for the whole call: an interrupt taken while a byte waits loses it (clock.h). The field flag is
 * polled in @wait instead, and Y counts the fields seen; they are added to the clock at the end, still masked.
 *
 * The bound that keeps the poll from costing a byte: a byte must be read within 28.4 cycles of its DRQ (32 us at
 * 888.6 kHz). @wait
 * reads the status at S1..S4, never more than 17 cycles apart (S1->S2 16, S2->S1 16, S1->S3 16, S3->S4 13,
 * S4->S1 17), and a DRQ seen is read 9 cycles later, so the worst first byte is read 26 cycles after its DRQ
 * (the loop without the poll: 25), 2.4 cycles inside the limit. The poll runs on every pass of @wait that finds no
 * DRQ: through the whole search for the first sector, through every gap between sectors, and at each sixteen-byte
 * boundary inside a sector whenever the CPU gets there before the next byte. So at least once per sector, and the
 * longest stretch without a poll is one sector's 256 bytes (8.2 ms), well inside a field (20 ms): the one-deep
 * flag never has to hold two. A flag set during the last sector is still set at the PULS CC, and the interrupt
 * takes it there. test/harness/clock.cjs measures the sample spacing and forces the S3/S4 phases.
 *
 * The fields seen go to the clock in one add at @end, not a clockField() call each: @end runs in the gap before
 * the next part's sector, which diskRead only just catches, and a loop of calls (about ten after a whole track)
 * made it miss that sector by a revolution (measured). */
static asm void readTrackPart(){
 asm {
   pshs cc,dp,u,y
   orcc #$50
   ldy #0
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
   lda <$03
   bmi @fs
   lda <$40
   bita #2
   bne @d0
   anda #5
   cmpa #1
   beq @wait
   bita #2
   bne @d0
   lbra @bad
@fs lda <$40
   bita #2
   bne @d0
   lda <$02
   lda <$40
   bita #2
   bne @d0c
   leay 1,y
   bra @wait
@d0c lda <$43
   sta ,x+
   leay 1,y
   bra @w1
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
@end tfr y,d
   tst _clockOn
   beq @none
   addb _clockTicks
   adca #0
@sec subd #FIELD_HZ
   bcs @keep
   ldx _clockSeconds
   leax 1,x
   stx _clockSeconds
   bra @sec
@keep addd #FIELD_HZ
   stb _clockTicks
@none puls y,u,dp,cc,pc
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
