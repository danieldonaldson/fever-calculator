import struct,json,zlib,sys
d=open('sav/2.raw','rb').read()
H=json.load(open('sav/hm.json'))
STEP=2
W=44*64//STEP
img=[[0]*W for _ in range(W)]
lo,hi=65535,0
vals={}
for (tx,ty),o in zip(H['tiles'],H['offs']):
    a=struct.unpack_from('<4225H',d,o)
    lo=min(lo,min(a)); hi=max(hi,max(a))
    for iy in range(0,64,STEP):
        for ix in range(0,64,STEP):
            v=a[iy*65+ix]
            px=((tx+22)*64+ix)//STEP; py=((ty+22)*64+iy)//STEP
            img[W-1-py][px]=v
print('raw range',lo,hi)
import collections
hist=collections.Counter(v//100 for row in img for v in row)
print(sorted(hist.items())[:40])
def png(path,rows,w,h):
    raw=b''.join(b'\x00'+bytes(r) for r in rows)
    def chunk(t,b): return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
    open(path,'wb').write(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,0,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b''))
rows=[[min(255,max(0,(v-lo)*255//max(1,(hi-lo)))) for v in r] for r in img]
png('sav/height.png',rows,W,W)
thr=int(sys.argv[1]) if len(sys.argv)>1 else 1760
png('sav/water.png',[[40 if v<thr else 220 for v in r] for r in img],W,W)
