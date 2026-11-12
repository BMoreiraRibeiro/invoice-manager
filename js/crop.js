/* Recorte de documentos: deteção dos 4 cantos do papel e correção de perspetiva.
   Funções puras sobre dados RGBA (Uint8ClampedArray), sem dependências. */
(function () {
  "use strict";

  const DEFAULT_QUAD = [[0.03, 0.03], [0.97, 0.03], [0.97, 0.97], [0.03, 0.97]]; // TL, TR, BR, BL (0..1)

  function otsu(gray) {
    const histogram = new Float64Array(256);
    for (let i = 0; i < gray.length; i++) histogram[gray[i]]++;
    const total = gray.length;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * histogram[t];
    let sumBackground = 0, weightBackground = 0, best = 0, threshold = 127;
    for (let t = 0; t < 256; t++) {
      weightBackground += histogram[t];
      if (!weightBackground) continue;
      const weightForeground = total - weightBackground;
      if (!weightForeground) break;
      sumBackground += t * histogram[t];
      const meanBackground = sumBackground / weightBackground;
      const meanForeground = (sum - sumBackground) / weightForeground;
      const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
      if (between > best) { best = between; threshold = t; }
    }
    return threshold;
  }

  // Maior componente ligada (4 vizinhos) da máscara. Devolve { pixels: Int32Array de índices, count }.
  function largestComponent(mask, w, h) {
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let best = null, bestCount = 0;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || seen[start]) continue;
      let top = 0, count = 0;
      stack[top++] = start; seen[start] = 1;
      const members = [];
      while (top) {
        const index = stack[--top];
        members.push(index); count++;
        const x = index % w, y = (index - x) / w;
        if (x > 0 && mask[index - 1] && !seen[index - 1]) { seen[index - 1] = 1; stack[top++] = index - 1; }
        if (x < w - 1 && mask[index + 1] && !seen[index + 1]) { seen[index + 1] = 1; stack[top++] = index + 1; }
        if (y > 0 && mask[index - w] && !seen[index - w]) { seen[index - w] = 1; stack[top++] = index - w; }
        if (y < h - 1 && mask[index + w] && !seen[index + w]) { seen[index + w] = 1; stack[top++] = index + w; }
      }
      if (count > bestCount) { bestCount = count; best = members; }
    }
    return { pixels: best, count: bestCount };
  }

  function polygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) { const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length]; area += x1 * y2 - x2 * y1; }
    return Math.abs(area) / 2;
  }

  // Procura o papel numa imagem pequena (≈400 px). Devolve { quad, found }; quad normalizado (TL, TR, BR, BL).
  function detectQuad(data, w, h) {
    const gray = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    const threshold = otsu(gray);
    const mask = new Uint8Array(w * h);
    let brightSum = 0, brightCount = 0, darkSum = 0;
    for (let i = 0; i < mask.length; i++) { if (gray[i] > threshold) { mask[i] = 1; brightSum += gray[i]; brightCount++; } else darkSum += gray[i]; }
    const contrast = brightCount && brightCount < mask.length ? brightSum / brightCount - darkSum / (mask.length - brightCount) : 0;
    if (contrast < 40) return { quad: DEFAULT_QUAD.map(point => point.slice()), found: false }; // sem contraste entre papel e fundo
    const { pixels, count } = largestComponent(mask, w, h);
    const fraction = count / (w * h);
    if (!pixels || fraction < 0.08 || fraction > 0.85) return { quad: DEFAULT_QUAD.map(point => point.slice()), found: false };
    let tl = null, tr = null, br = null, bl = null, minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
    let left = w, right = 0, top = h, bottom = 0;
    for (const index of pixels) {
      const x = index % w, y = (index - x) / w;
      const sum = x + y, diff = x - y;
      if (sum < minSum) { minSum = sum; tl = [x, y]; }
      if (sum > maxSum) { maxSum = sum; br = [x, y]; }
      if (diff > maxDiff) { maxDiff = diff; tr = [x, y]; }
      if (diff < minDiff) { minDiff = diff; bl = [x, y]; }
      if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
    }
    let corners = [tl, tr, br, bl];
    if (polygonArea(corners) < count * 0.6) corners = [[left, top], [right, top], [right, bottom], [left, bottom]]; // forma estranha: usa a caixa
    // Os extremos são pixels do interior da forma: o ponto real do canto fica meio pixel mais fora.
    const quad = corners.map(([x, y]) => [Math.min(1, Math.max(0, (x + 0.5) / w)), Math.min(1, Math.max(0, (y + 0.5) / h))]);
    return { quad, found: true };
  }

  // Homografia que leva (0,0),(W,0),(W,H),(0,H) para os 4 pontos de origem. Devolve [a..h] (i = 1).
  function homography(width, height, quad) {
    const dst = [[0, 0], [width, 0], [width, height], [0, height]];
    const matrix = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = dst[i], [u, v] = quad[i];
      matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (let column = 0; column < 8; column++) {
      let pivot = column;
      for (let row = column + 1; row < 8; row++) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
      if (Math.abs(matrix[pivot][column]) < 1e-12) return null;
      [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
      for (let row = 0; row < 8; row++) {
        if (row === column) continue;
        const factor = matrix[row][column] / matrix[column][column];
        for (let k = column; k < 9; k++) matrix[row][k] -= factor * matrix[column][k];
      }
    }
    return matrix.map((row, i) => row[8] / row[i]);
  }

  // Tamanho do resultado a partir dos lados do quadrilátero (em píxeis da origem), limitado a maxSide.
  function outputSize(quad, maxSide = 2400) {
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    let width = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
    let height = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
    const scale = Math.min(1, maxSide / Math.max(width, height, 1));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  // Endireita o quadrilátero (píxeis da origem) para um retângulo, com interpolação bilinear.
  function warp(source, sw, sh, quad, dw, dh) {
    const H = homography(dw, dh, quad);
    const out = new Uint8ClampedArray(dw * dh * 4);
    if (!H) return out;
    const [a, b, c, d, e, f, g, hh] = H;
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const px = x + 0.5, py = y + 0.5;
        const k = g * px + hh * py + 1;
        let u = (a * px + b * py + c) / k - 0.5, v = (d * px + e * py + f) / k - 0.5;
        u = Math.min(sw - 1, Math.max(0, u)); v = Math.min(sh - 1, Math.max(0, v));
        const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
        const fx = u - x0, fy = v - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
        const o = (y * dw + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          out[o + ch] = (source[i00 + ch] * (1 - fx) + source[i10 + ch] * fx) * (1 - fy) + (source[i01 + ch] * (1 - fx) + source[i11 + ch] * fx) * fy;
        }
        out[o + 3] = 255;
      }
    }
    return out;
  }

  window.DocCrop = { detectQuad, homography, outputSize, warp, DEFAULT_QUAD };
})();
