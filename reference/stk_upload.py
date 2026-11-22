# Minimal STK500v1 (optiboot) uploader. Opens at 9600 then switches to 115200 (CH340 driver workaround).
import sys, time, serial
port, hexpath = sys.argv[1], sys.argv[2]
mem = {}
for line in open(hexpath):
    line=line.strip()
    if not line.startswith(':'): continue
    n=int(line[1:3],16); addr=int(line[3:7],16); typ=int(line[7:9],16)
    if typ==0:
        for i in range(n): mem[addr+i]=int(line[9+2*i:11+2*i],16)
size=max(mem)+1; img=bytes(mem.get(i,0xFF) for i in range(size))
s=serial.Serial(port,9600,timeout=0.5); s.baudrate=115200
def cmd(b, resp_len=0):
    s.write(bytes(b)+b'\x20')
    r=s.read(2+resp_len)
    if len(r)<2+resp_len or r[0]!=0x14 or r[-1]!=0x10: raise RuntimeError(f'bad resp {r!r} to {bytes(b)[:4]!r}')
    return r[1:-1]
# reset into bootloader
s.dtr=False; s.rts=False; time.sleep(0.1); s.dtr=True; s.rts=True; time.sleep(0.05); s.reset_input_buffer()
for i in range(20):
    try:
        s.reset_input_buffer(); cmd([0x30]); break
    except Exception: time.sleep(0.05)
else: raise SystemExit('no sync with bootloader')
sig=cmd([0x75],3); print('signature', sig.hex())
if sig.hex()!='1e950f': raise SystemExit('not ATmega328P')
PAGE=128
for a in range(0,size,PAGE):
    chunk=img[a:a+PAGE]; w=a//2
    cmd([0x55,w&0xFF,w>>8])
    cmd([0x64,len(chunk)>>8,len(chunk)&0xFF,0x46]+list(chunk))
# verify
bad=0
for a in range(0,size,PAGE):
    chunk=img[a:a+PAGE]; w=a//2
    cmd([0x55,w&0xFF,w>>8])
    r=cmd([0x74,len(chunk)>>8,len(chunk)&0xFF,0x46],len(chunk))
    if r!=chunk: bad+=1
cmd([0x51]); s.close()
print(f'wrote {size} bytes, verify', 'OK' if bad==0 else f'FAILED pages={bad}')
