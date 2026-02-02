// G-code generation module for CNC chocolate engraving
// Updated: font glyphs provide full G-code per character (including G2/G3 with I/J).

const fontH = require('./fontH'); // this is your updated fontH.txt

const fonts = {
  hershey: fontH
  // you can add block/script fonts later if they implement the same API
};

function getFont(fontName) {
  return fonts[fontName] || fonts.hershey;
}

function calculateAlignment(textWidth, barWidth, alignment) {
  switch (alignment) {
    case 'left': return 0;
    case 'right': return barWidth - textWidth;
    case 'centered':
    default: return (barWidth - textWidth) / 2;
  }
}

function generateGcode(job, config) {
  const out = [];

  // Extract config values
  const barWidth = config.bar_width;
  const barHeight = config.bar_height;

  const zSafe = config.z_safe_height;
  const zEngrave = config.z_engrave_depth;

  const feedRate = config.feed_rate;
  const gapTemplateToMessage = config.gap_template_to_message;
  const gapBetweenLines = config.gap_between_lines;

  const decimals = Number.isFinite(Number(config.decimals)) ? Number(config.decimals) : 6;

  // Font settings
  const templateFont = getFont(config.template_font);
  const templateFontSize = config.template_font_size;
  const templateAlignment = config.template_alignment;

  const messageFont = getFont(config.message_font);
  const messageAlignment = config.message_alignment;

  const hasMessage1 = job.message_1 && job.message_1.trim().length > 0;
  const hasMessage2 = job.message_2 && job.message_2.trim().length > 0;
  const messageCount = (hasMessage1 ? 1 : 0) + (hasMessage2 ? 1 : 0);

  const messageFontSize = messageCount <= 1
    ? config.message_font_size_1_line
    : config.message_font_size_2_lines;

  // Header
  out.push('; CNC Chocolate Engraver');
  out.push('; Job ID: ' + job.id);
  out.push('; Template: ' + config.template_text);
  out.push('; Message 1: ' + (job.message_1 || ''));
  out.push('; Message 2: ' + (job.message_2 || ''));
  out.push('');
  out.push('G21 ; Set units to millimeters');
  out.push('G90 ; Absolute positioning');
  out.push('G92 X0 Y0 Z0 ; Set current position as origin');
  out.push(`G0 Z${Number(zSafe).toFixed(decimals)} ; Raise to safe height`);
  out.push('');

  // Options for glyph transformation
  const glyphOpts = {
    decimals,
    // Enable these if you want glyph Z and F replaced by config values
    normalizeZ: !!config.normalize_glyph_z,
    zSafe,
    zEngrave,
    normalizeFeed: !!config.normalize_glyph_feed,
    feedRate
  };

  // Layout: start from top of bar, work down
  let currentY = barHeight;

  // --- Template line ---
  const templateText = config.template_text || '';
  if (templateText.length > 0) {
    const w = templateFont.getTextWidth(templateText, templateFontSize);
    const baseX = calculateAlignment(w, barWidth, templateAlignment);

    currentY -= templateFontSize;

    out.push('; Template: ' + templateText);
    out.push(...renderTextAsGlyphGcode(templateFont, templateText, templateFontSize, baseX, currentY, glyphOpts));
    out.push('');

    currentY -= gapTemplateToMessage;
  }

  // --- Message 1 ---
  if (hasMessage1) {
    const w = messageFont.getTextWidth(job.message_1, messageFontSize);
    const baseX = calculateAlignment(w, barWidth, messageAlignment);

    currentY -= messageFontSize;

    out.push('; Message 1: ' + job.message_1);
    out.push(...renderTextAsGlyphGcode(messageFont, job.message_1, messageFontSize, baseX, currentY, glyphOpts));
    out.push('');

    if (hasMessage2) currentY -= gapBetweenLines;
  }

  // --- Message 2 ---
  if (hasMessage2) {
    const w = messageFont.getTextWidth(job.message_2, messageFontSize);
    const baseX = calculateAlignment(w, barWidth, messageAlignment);

    currentY -= messageFontSize;

    out.push('; Message 2: ' + job.message_2);
    out.push(...renderTextAsGlyphGcode(messageFont, job.message_2, messageFontSize, baseX, currentY, glyphOpts));
    out.push('');
  }

  // Footer
  out.push('; End of job');
  out.push(`G0 Z${Number(zSafe).toFixed(decimals)} ; Raise to safe height`);
  out.push('G0 X0 Y0 ; Return to origin');
  out.push('M2 ; End program');

  return out.join('\n');
}

// Render text by stitching glyph gcode character-by-character.
// Each glyph gcode is transformed by scale + (xOffset, yOffset).
function renderTextAsGlyphGcode(font, text, fontSize, startX, startY, glyphOpts) {
  const lines = [];
  const scale = fontSize / font.CHAR_HEIGHT; // uses fontH.CHAR_HEIGHT
  let cursorX = startX;

  for (const ch of text) {
    const glyph = font.getCharacter(ch);
    // Translate glyph to current cursor
    const gx = cursorX;
    const gy = startY;

    // Render glyph gcode (already includes G0/G1/G2/G3 etc)
    const glyphLines = font.renderCharGcode(ch, fontSize, gx, gy, glyphOpts);
    lines.push(...glyphLines);

    // Advance cursor by glyph width * scale
    cursorX += glyph.width * scale;
  }

  return lines;
}

module.exports = {
  generateGcode,
  getFont,
  fonts
};
