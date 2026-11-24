        org $0c00
start   orcc #$50
        lds #$fe00
* The SAM decodes these by ADDRESS, not by the value written: the even member of a pair clears its bit and the odd
* sets it. $FFDA clears M0, $FFDD sets M1 and $FFDF sets TY -- so these three stores are what turn on ALL-RAM and
* select 64K, which the copy to $FE00 below needs (before them, the upper half is ROM and the stores are dropped).
* The A register's value is irrelevant to them.
        sta $ffda
        sta $ffdd
        sta $ffdf
* Clear BOTH screen pages before anything is drawn: the engine's own draw only paints what it knows about, so
* whatever the previous occupant of RAM left in $0400/$0600 showed as garbage for the first fields (~31-41) after
* the unpack. The VDG reads $0400 (and $1C00 is the engine image, so only the low page and the $E000 page are
* screen here; the high page is cleared by the engine's first clearScreen).
* (0, as the engine's own clearScreen fills it: a $60 cell would paint a green field, not black)
        ldx #$0400
        clra
        clrb
clrscr  std ,x++
        cmpx #$0600
        bcs clrscr              ; clear $0400..$05FF exactly; bls would run one store past the end
* The controls, on the screen while the level unpacks. Alphanumeric INTERNAL is $00 on $FF22: bit 7 (AG) clear
* selects text on the MC6847, and bit 4 (INTEXT) clear is the chip's own font. $FD, which this used to write, has
* bit 7 SET -- that is the highest-resolution GRAPHICS mode (AG=1, GM7), so the whole screen painted as an empty
* colour field and a player saw nothing at all while the level unpacked. The cells were written either way; the
* mode was what kept them off the screen (measured: $FD renders 0 ink pixels in the text rows, $00 renders all
* 25 cells as the glyphs the chip's font gives). The SAM already has the display at $0400 (its boot value), and
* the three stores above already turned all-RAM on.
        lda #$00
        sta $ff22
* The 32x16 text page at $0400 holds one byte a cell. Space is $60 in this VDG's internal font.
        ldx #$0400
        lda #$60
fill    sta ,x+
        cmpx #$0600
        bcs fill
* "ARROWS TURN, SPACE FIRES" on row 6 (cell $0400 + 6*32 + 3)
        ldx #$0400+6*32+3
        ldu #msgctl
putctl  lda ,u+
        beq done2
        sta ,x+
        bra putctl
done2
        ldx #compressed_end
        ldy #$fe00
copy    lda ,-x
        sta ,-y
        cmpx #compressed
        bne copy
        tfr y,x
        ldy #image_start
next    cmpy #image_end
        bhs launch
        ldb ,x+
        bmi match
        incb
literal lda ,x+
        sta ,y+
        decb
        bne literal
        bra next
match   andb #$7f
        addb #3
        pshs b
        ldd ,x++
        leau d,y
        puls b
again   lda ,u+
        sta ,y+
        decb
        bne again
        bra next
launch  jmp image_start
msgctl  fcc "ARROWS TURN  SPACE FIRES"
        fcb 0
compressed
        include "packed.inc"
compressed_end
