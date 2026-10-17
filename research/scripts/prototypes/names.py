import re,struct,sys
d=open(sys.argv[1],'rb').read()
def ok(b):
    try: t=b.decode('utf8')
    except: return None
    return None if any(ord(c)<32 for c in t) else t
s=d.find(b'Vergato Train Depot')-4
# forward
p=s; fwd=[]
while True:
    L=struct.unpack_from('<I',d,p)[0]
    t=ok(d[p+4:p+4+L]) if L<300 else None
    if t is None: break
    fwd.append(t); p+=4+L
end=p
# backward
p=s; back=[]
while True:
    found=None
    for q in range(p-4, max(p-4-300,0)-1, -1):
        L=struct.unpack_from('<I',d,q)[0]
        if q+4+L==p:
            t=ok(d[q+4:p])
            if t is not None: found=(q,t)
            break
    if not found: break
    back.append(found[1]); p=found[0]
start=p
names=back[::-1]+fwd
print('start',start,'end',end,'count',len(names))
print('header before start:', d[start-24:start].hex(' '))
print('after end:', d[end:end+24].hex(' '))
import json; json.dump(names,open(sys.argv[2],'w'))
