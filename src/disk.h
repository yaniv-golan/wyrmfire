/* Level-disk data. Nothing here is compiled-in content: every array below
 * points into RAM filled from the level disk at run time.
 *
 * RAM: engine $1C00-$4FFF, ASSETS $5000-$6DFF, PACK $6E00-$79FF,
 * AREA $7A00-$ABFF (unpacked region; compressed region read to its top),
 * GRID $AC00-$DFFF (up to 104 rows of 128 cells), screens $0400/$E000.
 * Low RAM: $010C-$010E the IRQ's JMP to fieldIrq (clock.h), $0200-$0207 the picture markers the harnesses
 * read, $0208-$0387 the renderer's column cache (scene.h; zeroed by main, as it is not in the loaded image).
 *
 * HGR2 level pack (WYRMFIRE.LVL): a 12-sector header at logical sector 30
 * read to PACK, then sector-aligned LZ regions at the absolute sectors in
 * diskOffset (never spanning the directory tracks). Word offsets of the
 * header arrays live at PACK+12..PACK+27; the checksum table offset at
 * PACK+28; the first region sector at PACK+30.
 *
 * HGA1 asset block (WYRMFIRE.DAT, logical sector 0): read to ASSETS.
 * 0 'HGA1', 4 length, 6 16-bit sum of bytes 8..length-1, 8 ASSET_COUNT
 * (offset,length) word pairs, then data. See tools/reference/assets.py. */
#define PACK ((byte *)0x6e00)
#define PACK_SECTOR 30
#define MAX_OBJECTS 64
#define PACK_SECTORS 12
#define doorCells ((word *)(PACK + *(word *)(PACK+12)))
#define doorGroups ((byte *)(PACK + *(word *)(PACK+14)))
#define zoneIndex ((byte *)(PACK + *(word *)(PACK+16)))
#define diskOffset ((word *)(PACK + *(word *)(PACK+18)))
#define diskCount ((byte *)(PACK + *(word *)(PACK+20)))
#define rawSize ((word *)(PACK + *(word *)(PACK+22)))
#define packedGrid ((byte *)(PACK + *(word *)(PACK+24)))
#define levelObjects ((byte *)(PACK + *(word *)(PACK+26)))

#define ASSETS ((byte *)0x5000)
#define ASSET_SECTOR 0
#define ASSET_SECTORS 30
#define ASSET_BYTES 7680
#define ASSET_COUNT 20
#define ASSET(i) (ASSETS + ((word *)(ASSETS+8))[(i)<<1])
#define ASSET_LEN(i) (((word *)(ASSETS+8))[((i)<<1)+1])
#define guard ASSET(0)
#define imp ASSET(1)
#define impCast ASSET(2)
#define fireball ASSET(3)
#define boss ASSET(4)
#define fist ASSET(5)
#define weapon ASSET(6)
#define flash ASSET(7)
#define shotgun ASSET(8)
#define marine ASSET(9)
#define wounded ASSET(10)
#define introNotes ASSET(11)
#define interNotes ASSET(12)
#define victoryNotes ASSET(13)
#define SND_FIRE 14
#define SND_BLAST 15
#define SND_DOOR 16
#define SND_HURT 17
#define SND_PICKUP 18
/* Level-data lines for the credits screen, each NUL-terminated (the converter
 * writes the credit of the WAD the disk was made from). */
#define CREDITS 19
