import struct,json,sys
d=open('sav/2.raw','rb').read()
p=355917456; N=1936
tiles=[struct.unpack_from('<ii',d,p+12*i) for i in range(N)]
q=p+N*12
# after list: 0,1936,-1,14,0,0,0,1936  then per tile: u32 4225 + data?
q+=32
offs=[]
for i in range(N):
    n=struct.unpack_from('<I',d,q)[0]
    if n!=4225: print('break at',i,n,d[q-16:q+16].hex(' ')); break
    offs.append(q+4); q+=4+n*2
print('tiles read',len(offs),'end',q, d[q:q+48].hex(' '))
json.dump({'tiles':tiles[:len(offs)],'offs':offs},open('sav/hm.json','w'))
