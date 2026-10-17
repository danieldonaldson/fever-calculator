import sys,numpy as np
d=open(sys.argv[1],'rb').read()
hits=[]
for align in range(4):
    a=np.frombuffer(d,dtype='<f4',offset=align,count=(len(d)-align)//4)
    n=len(a)-6
    x0,y0,z0,x1,y1,z1=(a[i:i+n] for i in range(6))
    w=x1-x0; h=y1-y0; dz=z1-z0
    m=(w>250)&(w<4000)&(h>250)&(h<4000)&(dz>0)&(dz<400)&(np.abs(x0)<5400)&(np.abs(y0)<5400)&(np.abs(x1)<5400)&(np.abs(y1)<5400)&(z0>-50)&(z0<300)
    for i in np.nonzero(m)[0]:
        hits.append((align+4*int(i),[round(float(v)) for v in a[i:i+6]]))
hits.sort()
print(len(hits))
for h in hits[:80]: print(h)
