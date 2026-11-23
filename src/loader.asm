        org $0c00
start   orcc #$50
        lds #$fe00
        sta $ffda
        sta $ffdd
        sta $ffdf
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
compressed
        include "packed.inc"
compressed_end
