import re,struct,sys
d=open(sys.argv[1],'rb').read()
class Bad(Exception): pass
def val(p,depth=0):
    if depth>20: raise Bad('deep')
    t=struct.unpack_from('<I',d,p)[0]; p+=4
    if t==2: return struct.unpack_from('<d',d,p)[0],p+8
    if t==3:
        n=struct.unpack_from('<I',d,p)[0]
        if n>100000: raise Bad('str')
        return d[p+4:p+4+n].decode('utf8','replace'),p+4+n
    if t==1: return bool(d[p]),p+1
    if t==4:
        p+=1; return tbl(p,depth+1)
    raise Bad(f'tag {t} at {p-4}')
def tbl(p,depth=0):
    n=struct.unpack_from('<I',d,p)[0]; p+=4
    if n>100000: raise Bad('cnt')
    r={}
    for i in range(n):
        k,p=val(p,depth); v,p=val(p,depth); r[k]=v
    return r,p
from collections import Counter
ok=Counter(); bad=Counter(); res=[]
for m in re.finditer(rb'industries/[a-z0-9_/]+\.con',d):
    s=m.start()
    if struct.unpack_from('<I',d,s-4)[0]!=len(m.group()): bad['nolen']+=1; continue
    try:
        params,p=tbl(m.end())
    except Bad as e:
        bad[str(e)[:12]]+=1; print('BAD',m.group(),s,e); continue
    f=struct.unpack_from('<16f',d,p)
    good=f[15]==1.0 and abs(f[10]-1)<1e-3
    ok[good]+=1
    if not good: print('NOMAT',m.group(),list(params)[:6])
    else: res.append((m.group().decode().split('/')[1],round(f[12]),round(f[13]),{k:v for k,v in params.items() if k!='modules'}))
print(ok,bad)
for r in res[:8]: print(r)
