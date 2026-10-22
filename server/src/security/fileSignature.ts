/**
 * Upload type detection. We never trust the browser-supplied filename or MIME type:
 * the extension must be allowlisted, the declared MIME must match it, AND the
 * file's magic bytes must match. Anything else (executables, HTML, SVG, scripts) is rejected.
 */
export interface DetectedType {
  mime: 'application/pdf' | 'image/png' | 'image/jpeg';
  ext: 'pdf' | 'png' | 'jpg';
}

const EXT_TO_TYPE: Record<string, DetectedType> = {
  pdf: { mime: 'application/pdf', ext: 'pdf' },
  png: { mime: 'image/png', ext: 'png' },
  jpg: { mime: 'image/jpeg', ext: 'jpg' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function magicMatches(buf: Buffer, mime: DetectedType['mime']): boolean {
  switch (mime) {
    case 'application/pdf':
      return buf.length > 8 && buf.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'image/png':
      return buf.length > 8 && buf.subarray(0, 8).equals(PNG_MAGIC);
    case 'image/jpeg':
      return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    default:
      return false;
  }
}

export function detectAllowedType(buf: Buffer, originalName: string, declaredMime: string): DetectedType | null {
  const match = /\.([a-z0-9]{1,5})$/i.exec(originalName ?? '');
  if (!match) return null;
  const type = EXT_TO_TYPE[match[1].toLowerCase()];
  if (!type) return null;
  if ((declaredMime ?? '').toLowerCase() !== type.mime) return null;
  if (!magicMatches(buf, type.mime)) return null;
  return type;
}
