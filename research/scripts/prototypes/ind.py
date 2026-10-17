import re,struct,sys
d=open(sys.argv[1],'rb').read()
def mat(off):
    f=struct.unpack_from('<16f',d,off)
    if f[15]!=1.0 or f[3]!=0 or f[7]!=0 or f[11]!=0 or abs(f[10]-1)>1e-3: return None
    if f[2]!=0 or f[6]!=0 or f[8]!=0 or f[9]!=0: return None
    if abs(f[0]*f[0]+f[1]*f[1]-1)>1e-3: return None
    if abs(f[0]-f[5])>1e-3 or abs(f[1]+f[4])>1e-3: return None
    return f
out=[]
for m in re.finditer(rb'(?<=....)industries/[a-z0-9_/]+\.con',d):
    s=m.start(); L=struct.unpack_from('<I',d,s-4)[0]
    if L!=len(m.group()): continue
    for off in range(m.end(), m.end()+20000):
        f=mat(off)
        if f: out.append((m.group().decode(), off-m.end(), round(f[12]),round(f[13]),round(f[14],1))); break
for o in out: print(*o)
print(len(out))
