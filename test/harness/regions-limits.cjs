// regions.cjs with CI's limits, for test/pacing-mutants.sh: node regions-limits.cjs CLOADM_DIR BUILD_DIR
// SPDX-License-Identifier: GPL-3.0-or-later
process.argv.push('--max-unpack-fields', '2087', '--max-read-fields', '2902');
require('./regions.cjs');
