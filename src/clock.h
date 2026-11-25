/* The level clock: real PAL fields, counted from the VDG's field sync.
 *
 * FS reaches PIA0 CB1 and sets bit 7 of CRB ($FF03) on its falling edge, once per field (50 a second on the PAL
 * Dragon 64; FIELD_HZ). The flag stays set until PORT B DATA ($FF02) is read; a CRB read or write does not clear
 * it. With CRB bit 0 set, the flag pulls IRQ.
 *
 * The 6809 takes IRQ through $FFF8, which the SAM serves from the firmware's $BFF8 even in the all-RAM map the
 * loader selects; the firmware points it at the RAM vector $010C, as Dragon BASIC does, so the engine owns the
 * interrupt by writing a JMP there.
 *
 * Who counts a field: fieldIrq() whenever IRQ is unmasked, and readTrackPart() (floppy.h) and tune() while they
 * hold IRQ masked -- they poll the same flag at points where a poll costs nothing that matters (tune() hands
 * each field to clockField(); readTrackPart() counts them and adds them in one go). Whoever reads $FF02 first
 * counts the field, so no field is counted twice, and every masked stretch polls at least once a field, so none
 * is lost (see readTrackPart for its bound).
 *
 * Why the transfer cannot just take the interrupt: a double-density byte arrives every 32 us, 28.4 CPU cycles
 * (the PAL Dragon's CPU runs at 14.218 MHz / 16 = 888.6 kHz),
 * and the IRQ entry and RTI alone cost 34. A byte read late sets Lost Data, the WD2797 raises no DRQ for the rest
 * of the command, and the unrolled DRQ waits in readTrackPart (which test DRQ only) spin for ever. That was the
 * earlier build that never reached the game loop. */
#define FIELD_HZ 50
static byte clockOn,clockTicks;   /* clockTicks: fields into the current second, 0..FIELD_HZ-1 */
static word clockSeconds;
/* One field of level time. Call with IRQ masked; uses A and X (extended addressing only: readTrackPart calls it
 * with DP=$FF). Not static: CMOC drops a static function that only assembly calls. */
asm void clockField(){
 asm {
    tst _clockOn
    beq @off
    lda _clockTicks
    inca
    cmpa #FIELD_HZ
    blo @keep
    ldx _clockSeconds
    leax 1,x
    stx _clockSeconds
    clra
@keep sta _clockTicks
@off rts
 }
}
/* The IRQ line is shared: PIA0's two sides and, on the Dragon 64, the 6551 ACIA. Only the field-sync flag (CRB
 * bit 7) counts a field; anything else is acknowledged -- a PORT A read clears PIA0's HS flag, a STATUS read clears
 * the ACIA's -- and not counted, so a stray source can neither hold IRQ down nor run the clock fast. Both
 * acknowledgements are tested in CLOADM (test/harness/clock.cjs): HS by enabling PIA0's CA1 interrupt; the ACIA by
 * raising an interrupt in CLOADM's 6551 model directly, since the engine never programs the 6551 to raise one --
 * so the ACIA case rests on that model's read-status-clears-IRQ behaviour, not on a real serial event. */
static asm void fieldIrq(){
 asm {
    lda $ff03
    bpl @other
    lda $ff02
    lbsr _clockField
    rti
@other lda $ff00
    lda $ff05
    rti
 }
}
/* Vector first, then the PIA, then the CPU's mask: no IRQ can be taken before the JMP is whole. FIRQ stays
 * masked (PIA1 CB1 is the disk's DRQ and is not enabled). */
static void installClock(){
 *(byte*)0x10c=0x7e;*(word*)0x10d=(word)fieldIrq;
 IO(0xff03)|=1;
 asm {
    lda $ff02
    andcc #$ef
 }
}
/* Start a level's clock from 00:00. clockOn is cleared first, so the interrupt never sees a half-reset clock. */
static void clockStart(){clockOn=0;clockTicks=0;clockSeconds=0;clockOn=1;}
/* tune() holds IRQ masked so the interrupt cannot break up its waveform; it polls FS once a tick (about 7 ms). */
static byte savedCC;
static asm void irqHold(){
 asm {
    tfr cc,a
    sta _savedCC
    orcc #$10
    rts
 }
}
static asm void irqRelease(){
 asm {
    lda _savedCC
    tfr a,cc
    rts
 }
}
