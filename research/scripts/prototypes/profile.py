import sys,numpy as np
d=np.fromfile(sys.argv[1],dtype=np.uint8)
CH=1<<20
for c in range(len(d)//CH):
    blk=d[c*CH:(c+1)*CH]
    best=0
    for a in range(4):
        f=np.frombuffer(blk[a:a+CH-4].tobytes(),dtype='<f4')
        ok=np.isfinite(f)&(f>-300)&(f<2000)&((np.abs(f)>0.01))
        best=max(best,ok.mean())
    u=np.frombuffer(blk.tobytes(),dtype='<u2')
    du=np.abs(np.diff(u.astype(np.int32)))
    smooth=(du<64).mean()
    print(c, round(best,2), round(smooth,2), round((blk==0).mean(),2))
