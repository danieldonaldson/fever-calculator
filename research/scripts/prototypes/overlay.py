import struct,json,collections
from PIL import Image,ImageDraw,ImageFont
d=open('sav/2.raw','rb').read()
H=json.load(open('sav/hm.json')); E=json.load(open('sav/extract.json')); TB=json.load(open('sav/tb.json'))
names=json.load(open('sav/names.json'))[1:11]
# water mask, 1 px = 8 m
STEP=2; W=44*64//STEP
img=Image.new('RGB',(W,W))
px=img.load()
for (tx,ty),o in zip(H['tiles'],H['offs']):
    a=struct.unpack_from('<4225H',d,o)
    for iy in range(0,64,STEP):
        for ix in range(0,64,STEP):
            X=((tx+22)*64+ix)//STEP; Y=W-1-((ty+22)*64+iy)//STEP
            px[X,Y]=(70,110,160) if a[iy*65+ix]<2000 else (225,225,218)
def w2p(x,y): return ((x+5632)/8, W-1-(y+5632)/8)
# cluster buildings (single linkage, 180 m)
B=E['blds']; R=180
par=list(range(len(B)))
def f(i):
    while par[i]!=i: par[i]=par[par[i]]; i=par[i]
    return i
grid=collections.defaultdict(list)
for i,b in enumerate(B): grid[(int(b[0]//R),int(b[1]//R))].append(i)
for (gx,gy),L in grid.items():
    for dx in (-1,0,1):
        for dy in (-1,0,1):
            for j in grid.get((gx+dx,gy+dy),[]):
                for i in L:
                    if i<j and (B[i][0]-B[j][0])**2+(B[i][1]-B[j][1])**2<R*R: par[f(i)]=f(j)
cl=collections.defaultdict(list)
for i in range(len(B)): cl[f(i)].append(i)
clusters=sorted(cl.values(),key=len,reverse=True)
tcount=collections.Counter(t[1] for t in TB)
towns=sorted(tcount,key=lambda t:-tcount[t])
assert [len(c) for c in clusters]==[tcount[t] for t in towns], 'size match failed'
dr=ImageDraw.Draw(img)
try: font=ImageFont.truetype('DejaVuSans-Bold.ttf',18)
except: font=ImageFont.load_default()
COL={'r':(40,170,60),'c':(40,90,220),'i':(240,140,20)}
out=[]
for c,t in zip(clusters,towns):
    name=names[t-31366]; cents={}
    for k in 'rci':
        L=[B[i] for i in c if B[i][3]==k]
        if L: cents[k]=(sum(b[0] for b in L)/len(L),sum(b[1] for b in L)/len(L))
    for k,(x,y) in cents.items():
        X,Y=w2p(x,y); dr.ellipse([X-9,Y-9,X+9,Y+9],fill=COL[k],outline=(0,0,0),width=2)
    X,Y=w2p(*cents['r']); dr.text((X+14,Y-24),name,fill=(20,20,20),font=font,stroke_width=3,stroke_fill=(255,255,255))
    out.append((name,len(c),{k:(round(v[0]),round(v[1])) for k,v in cents.items()}))
for t,x,y in [(i[0],i[3],i[4]) for i in E['inds']]:
    X,Y=w2p(x,y); dr.ellipse([X-6,Y-6,X+6,Y+6],fill=(150,50,200),outline=(0,0,0),width=1)
img.save('sav/map.png')
for o in out: print(o)
