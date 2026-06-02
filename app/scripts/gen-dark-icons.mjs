// One-off: generate dark-theme launcher icon assets from the Pulse brand mark.
// Mark geometry is placed to match the existing light icons' bounding boxes
// exactly (measured from assets/adaptive-icon.png & assets/icon.png), so the
// dark icon is "the same size". Colors use the dark theme palette:
//   bg #111110 (theme.dark.bg) · waveform #eeeae1 (theme.dark.text) · dot #e87a4e (theme.dark.accent)
import sharp from 'sharp';

const SIZE = 1024;
const STROKE = '#eeeae1';
const DOT = '#e87a4e';

// Pulse mark in its native SVG units (from assets/pulse-mark.svg, viewBox 0..100).
const MARK = '<path d="M12 50 H34 L40 32 L48 66 L56 44 L62 50 H72" fill="none" stroke="STROKE" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="81" cy="50" r="5" fill="DOT"/>';

// Natural bbox of the mark in SVG units (accounting for the 2.5 stroke radius
// and the dot): x 9.5..86 (w 76.5), y 29.5..68.5 (h 39).
const NAT_X = 9.5;
const NAT_Y = 29.5;
const NAT_W = 76.5;

// Place the mark so its natural bbox lands on the target pixel bbox.
function placed(targetMinX, targetMinY, targetW) {
  const s = targetW / NAT_W; // uniform scale (aspect already matches)
  const tx = targetMinX - NAT_X * s;
  const ty = targetMinY - NAT_Y * s;
  const body = MARK.replaceAll('STROKE', STROKE).replaceAll('DOT', DOT);
  return `<g transform="translate(${tx} ${ty}) scale(${s})">${body}</g>`;
}

async function render(svg, out) {
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log('wrote', out);
}

// Adaptive foreground: transparent bg, mark at the measured adaptive bbox.
const fg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${placed(242, 375, 510)}</svg>`;

// Full square icon: dark bg, mark at the measured icon.png bbox.
const square = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="#111110"/>${placed(188, 348, 612)}</svg>`;

// Splash mark: transparent (sits on splash.backgroundColor), light waveform so
// it's visible on the dark splash. Matches the measured splash-icon.png bbox.
const splash = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${placed(284, 396, 431)}</svg>`;

await render(fg, 'assets/adaptive-icon-dark.png');
await render(square, 'assets/icon-dark.png');
await render(splash, 'assets/splash-icon-dark.png');
