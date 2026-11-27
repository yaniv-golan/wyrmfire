/* Engine-owned lookup tables (pure arithmetic; no level or WAD data).
 * cosine[i]    = round(32*cos(i*tau/32))
 * rayOffset[c] = round(-atan((c-15.5)/20)*96/tau): plane projection with
 *                non-uniform angular spacing and fish-eye correction. */
static const signed char cosine[32]={32,31,30,27,23,18,12,6,0,-6,-12,-18,-23,-27,-30,-31,-32,-31,-30,-27,-23,-18,-12,-6,0,6,12,18,23,27,30,31};
static const signed char rayOffset[32]={10,10,9,9,8,7,7,6,5,5,4,3,3,2,1,0,0,-1,-2,-3,-3,-4,-5,-5,-6,-7,-7,-8,-9,-9,-10,-10};
