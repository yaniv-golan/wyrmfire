// regions.cjs with CI's limits, for test/pacing-mutants.sh: node regions-limits.cjs CLOADM_DIR BUILD_DIR
// SPDX-License-Identifier: GPL-3.0-or-later
process.argv.push('--max-unpack-fields', '2087', '--max-net-read-fields', '1992.3', '--max-wait-fields', '13', '--max-read-fields', '2902');
require('./regions.cjs');
