export const UITheme = {
  palette: {
    borderDark: '#0b1116',
    borderLight: '#d9e5ee',
    fill1: '#0a566e',
    fill2: '#0b4d62',
    text: '#ffffff',
    shadow: '#13222c',
    selected: '#f2d200'
  },
  spacing: {
    pad: 10,
    rowGap: 8,
    colGap: 8,
    outer: 6,
    inner: 2
  }
};

export function createPanelSpritesheet() {
  const tile = 8;
  const c = document.createElement('canvas');
  c.width = tile * 3;
  c.height = tile * 3;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // fill
  ctx.fillStyle = UITheme.palette.fill1;
  ctx.fillRect(tile, tile, tile, tile);

  // edges
  ctx.fillStyle = UITheme.palette.borderDark;
  ctx.fillRect(tile, 0, tile, tile); // top
  ctx.fillRect(tile, tile * 2, tile, tile); // bottom
  ctx.fillRect(0, tile, tile, tile); // left
  ctx.fillRect(tile * 2, tile, tile, tile); // right

  // corners
  ctx.fillRect(0, 0, tile, tile);
  ctx.fillRect(tile * 2, 0, tile, tile);
  ctx.fillRect(0, tile * 2, tile, tile);
  ctx.fillRect(tile * 2, tile * 2, tile, tile);

  // inner light stroke cues in each piece
  ctx.fillStyle = UITheme.palette.borderLight;
  ctx.fillRect(1, 1, tile - 2, 1);
  ctx.fillRect(1, 1, 1, tile - 2);
  ctx.fillRect(tile + 1, 1, tile - 2, 1);
  ctx.fillRect(1, tile + 1, 1, tile - 2);
  ctx.fillRect(tile * 2 + 1, 1, tile - 2, 1);
  ctx.fillRect(tile * 2 + tile - 2, 1, 1, tile - 2);
  ctx.fillRect(1, tile * 2 + 1, 1, tile - 2);
  ctx.fillRect(1, tile * 2 + 1, tile - 2, 1);

  return { canvas: c, tile };
}

export function drawPanel9Slice(ctx, sheet, x, y, w, h) {
  const t = sheet.tile;
  const s = sheet.canvas;
  const midW = Math.max(0, w - t * 2);
  const midH = Math.max(0, h - t * 2);

  // corners
  ctx.drawImage(s, 0, 0, t, t, x, y, t, t);
  ctx.drawImage(s, t * 2, 0, t, t, x + w - t, y, t, t);
  ctx.drawImage(s, 0, t * 2, t, t, x, y + h - t, t, t);
  ctx.drawImage(s, t * 2, t * 2, t, t, x + w - t, y + h - t, t, t);

  // edges
  if (midW > 0) {
    ctx.drawImage(s, t, 0, t, t, x + t, y, midW, t);
    ctx.drawImage(s, t, t * 2, t, t, x + t, y + h - t, midW, t);
  }
  if (midH > 0) {
    ctx.drawImage(s, 0, t, t, t, x, y + t, t, midH);
    ctx.drawImage(s, t * 2, t, t, t, x + w - t, y + t, t, midH);
  }

  // fill tile repeat
  if (midW > 0 && midH > 0) {
    const p = ctx.createPattern(s, 'repeat');
    ctx.save();
    ctx.fillStyle = p;
    ctx.translate(x + t, y + t);
    ctx.fillRect(0, 0, midW, midH);
    ctx.restore();
    ctx.fillStyle = UITheme.palette.fill2;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x + t, y + t, midW, midH);
    ctx.globalAlpha = 1;
  }
}

export function drawText(ctx, text, x, y, size = 10) {
  ctx.font = `${size}px sm-pixel, monospace`;
  ctx.fillStyle = UITheme.palette.shadow;
  ctx.fillText(text, Math.round(x + 1), Math.round(y + 1));
  ctx.fillStyle = UITheme.palette.text;
  ctx.fillText(text, Math.round(x), Math.round(y));
}

export function drawLabelValueRows(ctx, rows, x, y, w) {
  let yy = y;
  for (const row of rows) {
    drawText(ctx, row.label, x, yy, 10);
    const txt = String(row.value);
    const m = ctx.measureText(txt).width;
    drawText(ctx, txt, x + w - m, yy, 10);
    yy += 12;
  }
}
