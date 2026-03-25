/**
 * optimize-images.mjs
 *
 * Build script that transforms 19.5MB of full-scene PNG assets into
 * web-optimized WebP images under 2MB total.
 *
 * What it does:
 * 1. Background: Reads MainBackground.png (12.9MB, 5568x3072) and generates
 *    three WebP variants at 1920w, 2560w, 3840w with quality 80.
 * 2. Overlays: Reads each overlay PNG (full 5568x3072 with transparency),
 *    crops to tight bounding box via sharp.trim(), converts to WebP.
 * 3. Blur placeholders: Generates tiny base64 data URLs for each image
 *    (progressive loading -- blur-up effect).
 * 4. Position metadata: Computes each overlay's position as percentages of
 *    the scene dimensions, derived from sharp's trim offsets.
 * 5. Outputs app/lib/image-data.ts with all metadata for downstream components.
 *
 * Usage:
 *   cd scripts && node optimize-images.mjs
 *
 * Why sharp? Already bundled with Next.js -- zero new dependencies.
 * Why trim()? Overlays are full-scene PNGs where most pixels are transparent.
 *   trim() finds the bounding box of the actual content.
 * Why percentage positions? Scene scales responsively -- pixel positions
 *   would break at different viewport sizes.
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve paths relative to this script's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const INPUT_DIR = path.join(PROJECT_ROOT, 'WebsiteAssets');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'app', 'public', 'scene');
const IMAGE_DATA_PATH = path.join(PROJECT_ROOT, 'app', 'lib', 'image-data.ts');

// Original scene dimensions -- all source PNGs are this size
const SCENE_WIDTH = 5568;
const SCENE_HEIGHT = 3072;

// Overlay definitions: source filename -> output kebab-case name
const OVERLAYS = [
  { src: 'Banner.png', name: 'banner' },
  { src: 'CarnageCauldron.png', name: 'carnage-cauldron' },
  { src: 'ConnectWallet.png', name: 'connect-wallet' },
  { src: 'DocumentationTable.png', name: 'documentation-table' },
  { src: 'RewardsVat.png', name: 'rewards-vat' },
  { src: 'Settings.png', name: 'settings' },
  { src: 'SwapStation.png', name: 'swap-station' },
];

// Background responsive breakpoints (widths in pixels)
const BG_WIDTHS = [1920, 2560, 3840];

/**
 * Process the background image into multiple responsive WebP variants.
 *
 * Why multiple sizes? A 1920px-wide screen doesn't need a 3840px image.
 * Next.js Image srcset picks the right one based on viewport width.
 *
 * Returns the base64 blur placeholder data URL.
 */
async function processBackground() {
  const inputPath = path.join(INPUT_DIR, 'MainBackground.png');
  const outputDirBg = path.join(OUTPUT_DIR, 'background');
  mkdirSync(outputDirBg, { recursive: true });

  console.log('Processing background: MainBackground.png');

  // Get original dimensions for logging
  const metadata = await sharp(inputPath).metadata();
  console.log(`  Original: ${metadata.width}x${metadata.height}, ${metadata.format}`);

  // Generate each responsive variant
  for (const width of BG_WIDTHS) {
    const outputPath = path.join(outputDirBg, `factory-bg-${width}.webp`);
    const result = await sharp(inputPath)
      .resize(width)
      .webp({ quality: 80 })
      .toFile(outputPath);

    const sizeKB = Math.round(result.size / 1024);
    console.log(`  -> factory-bg-${width}.webp: ${result.width}x${result.height}, ${sizeKB}KB`);
  }

  // Generate tiny blur placeholder (20px wide, quality 20)
  // Why 20px? Small enough to be ~250 bytes but captures scene composition
  const blurBuffer = await sharp(inputPath)
    .resize(20)
    .webp({ quality: 20 })
    .toBuffer();

  const blurDataURL = `data:image/webp;base64,${blurBuffer.toString('base64')}`;
  console.log(`  Blur placeholder: ${blurBuffer.length} bytes`);

  return { blurDataURL, width: SCENE_WIDTH, height: SCENE_HEIGHT };
}

/**
 * Process a single overlay PNG:
 * 1. Trim transparent pixels to find bounding box
 * 2. Convert to WebP
 * 3. Generate blur placeholder
 * 4. Compute position as percentages of scene dimensions
 *
 * Why trim()? Each overlay is 5568x3072 but the actual object might only
 * be 400x300 pixels -- the rest is transparent. trim() removes the
 * transparent border and tells us where the object was positioned via
 * trimOffsetLeft/trimOffsetTop.
 */
async function processOverlay(overlay) {
  const inputPath = path.join(INPUT_DIR, overlay.src);
  const outputDirOv = path.join(OUTPUT_DIR, 'overlays');
  mkdirSync(outputDirOv, { recursive: true });

  console.log(`Processing overlay: ${overlay.src}`);

  // Step 1: Trim transparent pixels to bounding box
  // threshold: 10 means pixels with alpha < 10 are considered transparent
  // resolveWithObject: true returns trimOffsetLeft/Top (position in original)
  const { data, info } = await sharp(inputPath)
    .trim({ threshold: 10 })
    .toBuffer({ resolveWithObject: true });

  // Guard against zero-dimension output (fully transparent image)
  if (info.width <= 0 || info.height <= 0) {
    console.error(`  WARNING: ${overlay.src} trimmed to zero dimensions. Skipping.`);
    return null;
  }

  console.log(`  Trimmed: ${info.width}x${info.height} (offset: ${info.trimOffsetLeft}, ${info.trimOffsetTop})`);

  // Step 2: Convert trimmed buffer to WebP
  // Quality 82 balances file size vs visual quality for overlay details
  const outputPath = path.join(outputDirOv, `${overlay.name}.webp`);
  const result = await sharp(data)
    .webp({ quality: 82 })
    .toFile(outputPath);

  const sizeKB = Math.round(result.size / 1024);
  console.log(`  -> ${overlay.name}.webp: ${result.width}x${result.height}, ${sizeKB}KB`);

  // Step 3: Generate tiny blur placeholder (10px wide, quality 20)
  // Overlays are smaller than background so 10px captures enough detail
  const blurBuffer = await sharp(data)
    .resize(10)
    .webp({ quality: 20 })
    .toBuffer();

  const blurDataURL = `data:image/webp;base64,${blurBuffer.toString('base64')}`;
  console.log(`  Blur placeholder: ${blurBuffer.length} bytes`);

  // Step 4: Compute position as percentages of scene dimensions
  // Why percentages? The scene scales with viewport -- absolute pixels would break
  // Note: sharp returns negative offsets (pixels removed from left/top edge).
  // Math.abs() converts to the actual content position within the scene.
  const left = (Math.abs(info.trimOffsetLeft ?? 0) / SCENE_WIDTH) * 100;
  const top = (Math.abs(info.trimOffsetTop ?? 0) / SCENE_HEIGHT) * 100;
  const widthPct = (info.width / SCENE_WIDTH) * 100;
  const heightPct = (info.height / SCENE_HEIGHT) * 100;

  console.log(`  Position: left=${left.toFixed(2)}%, top=${top.toFixed(2)}%, w=${widthPct.toFixed(2)}%, h=${heightPct.toFixed(2)}%`);

  return {
    name: overlay.name,
    src: `/scene/overlays/${overlay.name}.webp`,
    blurDataURL,
    width: info.width,
    height: info.height,
    left: parseFloat(left.toFixed(2)),
    top: parseFloat(top.toFixed(2)),
    widthPct: parseFloat(widthPct.toFixed(2)),
    heightPct: parseFloat(heightPct.toFixed(2)),
    available: true,
  };
}

/**
 * Generate the TypeScript metadata file that downstream components consume.
 *
 * Why generate instead of hand-write? The trim offsets and dimensions come
 * from sharp's analysis of the actual PNG content -- they can't be known
 * ahead of time. Generating ensures metadata is always in sync with the
 * actual optimized images.
 */
function generateImageDataTS(bgData, overlayData) {
  // Build overlay entries as formatted TypeScript object literals
  const overlayEntries = overlayData.map((o) => `    '${o.name}': {
      src: '${o.src}',
      blurDataURL: '${o.blurDataURL}',
      width: ${o.width},
      height: ${o.height},
      left: ${o.left},
      top: ${o.top},
      widthPct: ${o.widthPct},
      heightPct: ${o.heightPct},
      available: ${o.available},
    }`);

  const tsContent = `/**
 * image-data.ts
 *
 * Auto-generated by scripts/optimize-images.mjs
 * DO NOT EDIT MANUALLY -- re-run the script to regenerate.
 *
 * Contains blur placeholder data URLs, overlay dimensions, and position
 * metadata for the factory scene. All positions are percentages of the
 * original 5568x3072 scene dimensions.
 */

/** Metadata for the scene background image */
export interface BackgroundData {
  /** Path to the default (1920w) background WebP */
  src: string;
  /** Tiny base64 blur placeholder for progressive loading */
  blurDataURL: string;
  /** Original scene width in pixels */
  width: number;
  /** Original scene height in pixels */
  height: number;
}

/** Metadata for a single overlay image */
export interface OverlayData {
  /** Path to the overlay WebP in public/ */
  src: string;
  /** Tiny base64 blur placeholder for progressive loading */
  blurDataURL: string;
  /** Cropped overlay width in pixels */
  width: number;
  /** Cropped overlay height in pixels */
  height: number;
  /** Left position as percentage of scene width (0-100) */
  left: number;
  /** Top position as percentage of scene height (0-100) */
  top: number;
  /** Width as percentage of scene width (0-100) */
  widthPct: number;
  /** Height as percentage of scene height (0-100) */
  heightPct: number;
  /** Whether the asset file exists (false for placeholders like swap-station) */
  available: boolean;
}

/** Complete scene data structure */
export interface SceneData {
  background: BackgroundData;
  overlays: Record<string, OverlayData>;
}

export const SCENE_DATA: SceneData = {
  background: {
    src: '/scene/background/factory-bg-1920.webp',
    blurDataURL: '${bgData.blurDataURL}',
    width: ${bgData.width},
    height: ${bgData.height},
  },
  overlays: {
${overlayEntries.join(',\n')},
  },
} as const;
`;

  writeFileSync(IMAGE_DATA_PATH, tsContent);
  console.log(`\nGenerated: ${IMAGE_DATA_PATH}`);
}

/**
 * Main entry point -- orchestrates the full optimization pipeline.
 */
async function main() {
  console.log('=== Image Optimization Pipeline ===');
  console.log(`Scene dimensions: ${SCENE_WIDTH}x${SCENE_HEIGHT}`);
  console.log(`Input: ${INPUT_DIR}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('');

  // Process background
  const bgData = await processBackground();
  console.log('');

  // Process each overlay
  const overlayResults = [];
  for (const overlay of OVERLAYS) {
    const result = await processOverlay(overlay);
    if (result) {
      overlayResults.push(result);
    }
    console.log('');
  }

  // Generate TypeScript metadata file
  generateImageDataTS(bgData, overlayResults);

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Background variants: ${BG_WIDTHS.length}`);
  console.log(`Overlays processed: ${overlayResults.length}`);
  console.log('Done!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
