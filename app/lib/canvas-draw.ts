export type CoverSourceRect = { sx: number; sy: number; sw: number; sh: number };

export function coverSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  destWidth: number,
  destHeight: number,
): CoverSourceRect {
  const width = Math.max(1, sourceWidth);
  const height = Math.max(1, sourceHeight);
  const destW = Math.max(1, destWidth);
  const destH = Math.max(1, destHeight);
  const sourceRatio = width / height;
  const destRatio = destW / destH;

  if (sourceRatio > destRatio) {
    const croppedWidth = height * destRatio;
    return { sx: (width - croppedWidth) / 2, sy: 0, sw: croppedWidth, sh: height };
  }
  if (sourceRatio < destRatio) {
    const croppedHeight = width / destRatio;
    return { sx: 0, sy: (height - croppedHeight) / 2, sw: width, sh: croppedHeight };
  }
  return { sx: 0, sy: 0, sw: width, sh: height };
}

export function drawImageCover(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource & { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number },
  destWidth: number,
  destHeight: number,
) {
  const sourceWidth = image.naturalWidth || Number(image.width) || destWidth;
  const sourceHeight = image.naturalHeight || Number(image.height) || destHeight;
  const { sx, sy, sw, sh } = coverSourceRect(sourceWidth, sourceHeight, destWidth, destHeight);
  context.drawImage(image, sx, sy, sw, sh, 0, 0, destWidth, destHeight);
}
