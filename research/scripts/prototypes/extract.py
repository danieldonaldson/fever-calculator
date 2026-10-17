import sys,re,struct,json,math,collections
sys.path.insert(0,'tools'); from lua import mk
d=open(sys.argv[1],'rb').read(); tbl=mk(d)
names=json.load(open(sys.argv[2]))
cons=[]
for m in re.finditer(rb'(buildings|industries)/[a-z0-9_/]+\.con',d):
    s=m.start()
    if struct.unpack_from('<I',d,s-4)[0]!=len(m.group()): continue
    try: params,p=tbl(m.end())
    except Exception as e: continue
    f=struct.unpack_from('<16f',d,p)
    if not(f[15]==1.0 and abs(f[10]-1)<1e-3): continue
    cons.append((m.group().decode(),f[12],f[13],params))
inds=[c for c in cons if c[0].startswith('industries')]
blds=[c for c in cons if c[0].startswith('buildings')]
print(len(inds),len(blds))
# industry name suffixes per type: learn from names list
SUF={'farm':'Crop Farm','fishing_grounds':'Fishing Grounds','oil_refinery':'Oil Refinery','oil_platform':'Oil Platform','bricks_works':'Brickworks','clay_pit':'Clay Pit','livestock_farm':'Livestock Farm','saw_mill':'Saw Mill','forest':'Logging Camp'}
typ=lambda c:c[0].split('/')[1]
cand=[i for i,n in enumerate(names) if n!='no name']
# show unique suffixes for unknown types
towns=names[1:11]
print('towns',towns)
def strip(n):
    n=re.sub(r' (#\d+|North|South|East|West)$','',n)
    for t in sorted(towns,key=len,reverse=True):
        if n.startswith(t+' '): return t,n[len(t)+1:]
    return None,None
sufs=collections.Counter(strip(n)[1] for n in names if strip(n)[0])
print(sufs.most_common(60))
SUF.update({'iron_ore_mine':'Iron Ore Mine','coal_mine':'Coal Mine','steel_mill':'Steel Mill','cotton_farm':'Cotton Farm','food_factory':'Canning Factory','sand_excavator':'Sand Dredger','brewery':'Brewery','textile_factory':'Textile Factory','chemical_plant':'Chemical Plant','weaving_mill':'Weaving Mill','machine_factory':'Machine Factory','tool_factory':'Tools Factory','furniture_factory':'Furniture Factory','glass_works':'Glassworks','vehicle_factory':'Vehicle Factory'})
used=set(); out=[]
entries=[(i,n,)+strip(n) for i,n in enumerate(names)]
ptr=0
for c in inds:
    want=SUF[typ(c)]
    hit=None
    for i,n,t,s in entries:
        if i in used or s!=want: continue
        hit=(i,n,t); break
    if hit:
        used.add(hit[0])
        for i,n,t,s in entries:
            if i>hit[0] and i not in used and n==hit[1]: used.add(i); break
    out.append((typ(c),hit[1] if hit else None,hit[2] if hit else None,round(c[1]),round(c[2])))
for o in out[:40]: print(o)
# sanity: town of industry should be nearish to buildings of that town; compute per-town centroid of its industries
by=collections.defaultdict(list)
for o in out:
    if o[2]: by[o[2]].append((o[3],o[4]))
for t,v in by.items(): print(t,len(v),round(sum(x for x,y in v)/len(v)),round(sum(y for x,y in v)/len(v)))
json.dump({'inds':out,'blds':[(round(b[1]),round(b[2]),b[3].get('capacity',0),b[0].split('/')[2][0]) for b in blds]},open('sav/extract.json','w'))
