// Byte-level reader/writer for Hapax files (docs/FORMAT.md §2).
// Little-endian integers, NUL-terminated strings, and object tags made of a
// class id byte followed by a version byte stored as 0x30 + n.

export class ParseError extends Error {
  constructor(
    readonly file: string,
    readonly offset: number,
    readonly reason: string,
    readonly context: string,
  ) {
    super(`${file}@${offset} (0x${offset.toString(16)}): ${reason}  next: ${context}`);
    this.name = 'ParseError';
  }
}

export const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

export class Reader {
  pos = 0;
  private readonly view: DataView;

  constructor(
    readonly buf: Uint8Array,
    readonly file: string,
  ) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  fail(reason: string): never {
    throw new ParseError(this.file, this.pos, reason, hex(this.buf.subarray(this.pos, this.pos + 16)));
  }

  eof(): boolean {
    return this.pos >= this.buf.length;
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) this.fail(`read of ${n} bytes past end of file`);
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++];
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  raw(n: number): Uint8Array {
    this.need(n);
    const b = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }

  rest(): Uint8Array {
    return this.raw(this.buf.length - this.pos);
  }

  /** NUL-terminated string, decoded as Latin-1 so every byte round-trips. */
  cstr(): string {
    const end = this.buf.indexOf(0, this.pos);
    if (end < 0) this.fail('unterminated string');
    let s = '';
    for (let i = this.pos; i < end; i++) s += String.fromCharCode(this.buf[i]);
    this.pos = end + 1;
    return s;
  }

  /** u8 presence flag, then a string if present. */
  optStr(): string | null {
    return this.u8() ? this.cstr() : null;
  }

  peekTag(): { cls: number; version: number } | null {
    if (this.pos + 1 >= this.buf.length) return null;
    return { cls: this.buf[this.pos], version: this.buf[this.pos + 1] - 0x30 };
  }

  /** Expect an object tag; returns the version found. */
  tag(cls: number, versions: number | readonly number[]): number {
    const accepted = typeof versions === 'number' ? [versions] : versions;
    const t = this.peekTag();
    if (!t || t.cls !== cls || !accepted.includes(t.version)) {
      const want = accepted.map((v) => `v${v}`).join('/');
      const got = t ? `${t.cls.toString(16).padStart(2, '0')} v${t.version}` : 'end of file';
      this.fail(`expected object ${cls.toString(16).padStart(2, '0')} ${want}, found ${got}`);
    }
    this.pos += 2;
    return t.version;
  }

  /** Scalar wrapper `0e 31` + little-endian int. The width is not in the stream. */
  val(width: 1 | 2 | 4 = 1): number {
    this.tag(0x0e, 1);
    return width === 1 ? this.u8() : width === 2 ? this.u16() : this.u32();
  }
}

export class Writer {
  private buf = new Uint8Array(1024);
  private len = 0;

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  u16(v: number): void {
    this.u8(v);
    this.u8(v >>> 8);
  }

  u32(v: number): void {
    this.u16(v & 0xffff);
    this.u16(v >>> 16);
  }

  f32(v: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, v, true);
    this.raw(b);
  }

  raw(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }

  cstr(s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
    this.u8(0);
  }

  optStr(s: string | null): void {
    if (s === null) {
      this.u8(0);
    } else {
      this.u8(1);
      this.cstr(s);
    }
  }

  tag(cls: number, version: number): void {
    this.u8(cls);
    this.u8(0x30 + version);
  }

  val(v: number, width: 1 | 2 | 4 = 1): void {
    this.tag(0x0e, 1);
    if (width === 1) this.u8(v);
    else if (width === 2) this.u16(v);
    else this.u32(v);
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}
