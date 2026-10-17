import struct,json,math,re,sys
sys.path.insert(0,'tools'); from lua import mk
d=open('sav/2.raw','rb').read(); tbl=mk(d)
H=json.load(open('sav/hm.json')); idx={tuple(t):o for t,o in zip(H['tiles'],H['offs'])}
TS=256.0
def raw(x,y,order):
    tx=math.floor(x/TS); ty=math.floor(y/TS)
    o=idx.get((tx,ty))
    if o is None: return None
    fx=(x-tx*TS)/TS*64; fy=(y-ty*TS)/TS*64
    ix=min(64,round(fx)); iy=min(64,round(fy))
    k=iy*65+ix if order=='row' else ix*65+iy
    return struct.unpack_from('<H',d,o+2*k)[0]
pts=[]
for m in re.finditer(rb'industries/[a-z0-9_/]+\.con',d):
    if struct.unpack_from('<I',d,m.start()-4)[0]!=len(m.group()): continue
    params,p=tbl(m.end()); f=struct.unpack_from('<16f',d,p)
    pts.append((f[12],f[13],f[14],m.group().split(b'/')[1].decode()))
for order in ('row','col'):
    xs=[];zs=[]
    for x,y,z,t in pts:
        r=raw(x,y,order)
        if r is not None and t not in ('oil_platform','fishing_grounds'): xs.append(r); zs.append(z)
    n=len(xs); mx=sum(xs)/n; mz=sum(zs)/n
    b=sum((a-mx)*(c-mz) for a,c in zip(xs,zs))/sum((a-mx)**2 for a in xs); a0=mz-b*mx
    res=math.sqrt(sum((a0+b*a-c)**2 for a,c in zip(xs,zs))/n)
    print(order,'n',n,'scale',round(b,5),'offset',round(a0,2),'rms err',round(res,2),'zero raw',round(-a0/b,1))
    wat=[raw(x,y,order) for x,y,z,t in pts if t in ('oil_platform','fishing_grounds')]
    print('  water industry raw', sorted(wat)[:5], sorted(wat)[-5:])
print('---')
def bil(x,y):
    tx=math.floor(x/TS); ty=math.floor(y/TS); o=idx.get((tx,ty))
    fx=(x-tx*TS)/4; fy=(y-ty*TS)/4; ix=int(fx); iy=int(fy); ix=min(ix,63); iy=min(iy,63)
    g=lambda i,j: struct.unpack_from('<H',d,o+2*(j*65+i))[0]
    ax=fx-ix; ay=fy-iy
    return g(ix,iy)*(1-ax)*(1-ay)+g(ix+1,iy)*ax*(1-ay)+g(ix,iy+1)*(1-ax)*ay+g(ix+1,iy+1)*ax*ay
rows=sorted((bil(x,y),z,t) for x,y,z,t in pts)
for r in rows: print(round(r[0]),round(r[1],1),r[2])
