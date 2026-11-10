import struct, zlib, sys


def read_png(path):
    data = open(path, 'rb').read()
    pos = 8
    idat = b''
    w = h = ct = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', chunk[:10])
        elif typ == b'IDAT':
            idat += chunk
        pos += 12 + ln
    raw = zlib.decompress(idat)
    nch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    stride = w * nch
    out = bytearray()
    prev = bytearray(stride)
    i = 0
    for y in range(h):
        f = raw[i]
        i += 1
        line = bytearray(raw[i:i + stride])
        i += stride
        if f == 1:
            for x in range(nch, stride):
                line[x] = (line[x] + line[x - nch]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x - nch] if x >= nch else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - nch] if x >= nch else 0
                b = prev[x]
                c = prev[x - nch] if x >= nch else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out += line
        prev = line
    return w, h, nch, bytes(out)


if __name__ == '__main__':
    path = sys.argv[1]
    lo, hi = int(sys.argv[2]), int(sys.argv[3])
    w, h, nch, px = read_png(path)
    print('size', w, h)
    for y in range(lo, hi):
        xs = []
        for x in range(w):
            o = (y * w + x) * nch
            r, g, b = px[o], px[o + 1], px[o + 2]
            if b > 150 and b - r > 60 and b - g > 40:
                xs.append(x)
        if xs:
            print('y=%d: x %d..%d n=%d' % (y, min(xs), max(xs), len(xs)))
