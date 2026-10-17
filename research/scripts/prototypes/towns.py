import json,math,collections,sys
E=json.load(open('sav/extract.json')); B=E['blds']; names=json.load(open('sav/names.json'))[1:11]
R=float(sys.argv[1]) if len(sys.argv)>1 else 180
par=list(range(len(B)))
def f(i):
    while par[i]!=i: par[i]=par[par[i]]; i=par[i]
    return i
grid=collections.defaultdict(list)
for i,(x,y,*_) in enumerate(B): grid[(int(x//R),int(y//R))].append(i)
for (gx,gy),L in grid.items():
    for dx in (-1,0,1):
        for dy in (-1,0,1):
            for j in grid.get((gx+dx,gy+dy),[]):
                for i in L:
                    if i<j and (B[i][0]-B[j][0])**2+(B[i][1]-B[j][1])**2<R*R: par[f(i)]=f(j)
cl=collections.defaultdict(list)
for i in range(len(B)): cl[f(i)].append(i)
cls=sorted(cl.values(),key=len,reverse=True)
print('clusters',len(cls),[len(c) for c in cls[:25]])
big=[c for c in cls if len(c)>=15]
big.sort(key=lambda c:min(c))
for c in big:
    cx=sum(B[i][0] for i in c)/len(c); cy=sum(B[i][1] for i in c)/len(c)
    print(len(c),'minidx',min(c),'first20 frac', sum(1 for i in c if i< min(c)+200)/min(len(c),200), round(cx),round(cy))
