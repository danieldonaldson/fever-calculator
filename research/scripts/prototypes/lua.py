import struct
class Bad(Exception): pass
def mk(d):
    def val(p,depth=0):
        t=struct.unpack_from('<I',d,p)[0]; p+=4
        if t==2: return struct.unpack_from('<d',d,p)[0],p+8
        if t==3:
            n=struct.unpack_from('<I',d,p)[0]
            if n>100000: raise Bad('str')
            return d[p+4:p+4+n].decode('utf8','replace'),p+4+n
        if t==1: return bool(d[p]),p+1
        if t==4: return tbl(p+1,depth+1)
        raise Bad(f'tag {t} at {p-4}')
    def tbl(p,depth=0):
        if depth>30: raise Bad('deep')
        n=struct.unpack_from('<I',d,p)[0]; p+=4
        if n>100000: raise Bad('cnt')
        r={}
        for i in range(n):
            k,p=val(p,depth); v,p=val(p,depth); r[k]=v
        return r,p
    return tbl
