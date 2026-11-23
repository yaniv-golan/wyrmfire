/* Projectiles in 8.8 cell coordinates. Simulation never depends on the view angle. */
typedef struct {word x,y;int dx,dy;byte life;} Missile;
static Missile balls[4];
static byte wind[MAX_OBJECTS],waitForAttack[MAX_OBJECTS],aimColumn[MAX_OBJECTS],aimDepth[MAX_OBJECTS];
static byte thrown,impacts,wallHits,spreadVictims,animation;
static byte clearLine(byte x,byte y,byte tx,byte ty){
 int dx=(int)tx-x,dy=(int)ty-y,n,step;word fx=((word)x<<8)+128,fy=((word)y<<8)+128;
 int ax=dx<0?-dx:dx,ay=dy<0?-dy:dy;
 n=ax>ay?ax:ay;if(!n)return 1;
 dx=dx*256/n;dy=dy*256/n;
 for(step=0;step<n;step++){
   byte nx=(fx+dx)>>8,ny=(fy+dy)>>8;
   if(!cross(x,y,nx,y)||!cross(nx,y,nx,ny))return 0;
   fx+=dx;fy+=dy;x=nx;y=ny;
 }
 return 1;
}
static void hurt(byte n){
 if(armor){armor--;if(n>1)n--;}
 health=health>n?health-n:0;
}
static void releaseBall(const Thing *o){
 byte j;for(j=0;j<4;j++)if(!balls[j].life){
    Missile *m=balls+j;int dx,dy,ax,ay,n;
    m->x=((word)o->x<<8)+128;m->y=((word)o->y<<8)+128;
    dx=(int)(px-m->x)>>4;dy=(int)(py-m->y)>>4;
    ax=dx<0?-dx:dx;ay=dy<0?-dy:dy;n=ax>ay?ax:ay;if(n<1)n=1;
    m->dx=dx*64/n;m->dy=dy*64/n;m->life=64;thrown++;return;
 }
}
static void simulate(){
 byte n,j;findNearby();
 for(n=0;n<nearCount;n++){
   byte i=nearby[n];Thing *o=things+i;int x,y,ax,ay;
   if(o->kind==0||o->kind>5)continue;
   if(waitForAttack[i]){waitForAttack[i]--;continue;}
   if(wind[i]){
      if(!--wind[i]){releaseBall(o);waitForAttack[i]=20;}
      continue;
   }
   if(((turn+i)&7)!=0)continue;
   x=(int)o->x-(px>>8);y=(int)o->y-(py>>8);ax=x<0?-x:x;ay=y<0?-y:y;
   if(ax>10||ay>10||!clearLine(o->x,o->y,px>>8,py>>8))continue;
   if(o->kind==3||o->kind==5){wind[i]=5;continue;}
   if(ax<4&&ay<4){hurt(2);waitForAttack[i]=18;}
   else if(ax+ay>2){sb mx=x>0?-1:x<0?1:0,my=y>0?-1:y<0?1:0;
     if(mx&&cross(o->x,o->y,o->x+mx,o->y))o->x+=mx;
     else if(my&&cross(o->x,o->y,o->x,o->y+my))o->y+=my;}
 }
 for(j=0;j<4;j++)if(balls[j].life){
    Missile *m=balls+j;word nx=m->x+m->dx,ny=m->y+m->dy;
    int rx,ry;
    if(!cross(m->x>>8,m->y>>8,nx>>8,m->y>>8)||!cross(nx>>8,m->y>>8,nx>>8,ny>>8)){
      m->life=0;wallHits++;continue;
    }
    m->x=nx;m->y=ny;m->life--;rx=(int)(px-nx);ry=(int)(py-ny);
    if(rx>=-76&&rx<=76&&ry>=-76&&ry<=76){m->life=0;impacts++;hurt(8);}
 }
}
static void missiles(){
 byte j;for(j=0;j<4;j++)if(balls[j].life){
    int x=(int)(balls[j].x-px)>>4,y=(int)(balls[j].y-py)>>4;
    int z=(x*cosine[angle]+y*cosine[(angle+24)&31])>>5;
    int side=(x*cosine[(angle+24)&31]-y*cosine[angle])>>5;
    if(z>2&&side<z&&side> -z){int col=16+side*20/z;if(col>=1&&col<31&&z/4<=rayDistance[col]+2)
       sprite(fireball,col-1,74,2,12);}
 }
}
static void hit(byte i,byte damage){
 Thing *t=things+i;if(t->hp>damage)t->hp-=damage;
 else{wind[i]=0;t->kind=t->kind==1?6:t->kind==2?8:0;kills++;}
}
static void shotgunAttack(){
 static const sb offsets[7]={0,-1,1,-3,3,-5,5};
 byte pellet,j,n,touched=0,damage[MAX_OBJECTS];
 for(j=0;j<count;j++)damage[j]=0;
 for(pellet=0;pellet<7;pellet++){
    byte best=255,nearest=255;int lane=16+offsets[pellet];
    for(n=0;n<nearCount;n++){byte i=nearby[n];int delta=lane-aimColumn[i];
       if(aimColumn[i]!=255&&delta>=-1&&delta<=1&&aimDepth[i]<nearest){best=i;nearest=aimDepth[i];}}
    if(best!=255)damage[best]++;
 }
 for(j=0;j<count;j++)if(damage[j]){hit(j,damage[j]);touched++;}
 spreadVictims=touched;
}
