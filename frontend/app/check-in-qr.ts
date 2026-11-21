import jsQR from "jsqr";

export function isCheckInCode(value: string) {
  return /^[a-f0-9]{64}$/i.test(value);
}

export function readCheckInQr(context: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number) {
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = context.canvas;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  context.drawImage(source, 0, 0, w, h);
  const pixels = context.getImageData(0, 0, w, h);
  return jsQR(pixels.data, w, h)?.data ?? null;
}
