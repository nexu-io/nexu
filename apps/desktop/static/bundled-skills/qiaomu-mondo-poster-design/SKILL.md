---
name: qiaomu-mondo-poster-design
catalog-name: Qiaomu Mondo Poster Design
description: 一句话生成大师级海报、书籍封面、专辑封面和各类设计作品。无需懂PS、配色或艺术史，AI自动选择最佳风格（基于33+位传奇设计师）。支持多平台多比例：公众号封面(21:9)、小红书配图(3:4)、文章配图(16:9)、书籍封面(9:16)、专辑封面(1:1)、电影海报(9:16)。包含AI提示词优化、风格对比、图生图转换功能。触发词："Mondo风格"、"书籍封面设计"、"专辑封面"、"海报设计"、"读书笔记配图"、"公众号封面"、"小红书配图"、"文章配图"。One-sentence generation of master-level posters, book covers, album covers and designs. 33+ legendary designer styles with multi-platform aspect ratio support (21:9, 16:9, 3:4, 1:1, 9:16).
---

# Mondo Style Design Generator

Generate AI image prompts AND create actual designs in Mondo's distinctive alternative aesthetic - known for limited-edition screen-printed posters, book covers, and album art with bold colors, minimalist compositions, and symbolic storytelling.

**This skill can:**
- Generate detailed Mondo-style prompts for any subject
- Create actual images directly via AI Gateway API
- Design movie posters, book covers, album art, event posters
- Provide genre-specific and format-specific templates

## Core Mondo Aesthetic

Mondo posters are characterized by:

1. **Artistic Reinterpretation** - Not literal film scenes, but conceptual visual distillations
2. **Screen Print Aesthetics** - Limited color palettes (2-5 colors), flat color blocks, halftone textures
3. **Minimalist Symbolism** - Key props, silhouettes, negative space over character faces
4. **Bold Vintage Typography** - Hand-drawn lettering, condensed sans-serifs, Art Deco influences
5. **Retro Color Palettes** - High saturation, vintage duotones, bold contrasts (orange/teal, red/cream, etc.)

## Prompt Structure

When generating Mondo-style prompts, use this template:

```
[SUBJECT] in Mondo poster style, [COMPOSITION], [COLOR PALETTE],
screen print aesthetic, limited edition poster art, [KEY VISUAL ELEMENTS],
[TEXTURE/FINISH], minimalist design, vintage movie poster, [MOOD/TONE]
```

### Essential Components

**Style Anchors** (always include):
- "Mondo poster style" or "alternative movie poster"
- "screen print aesthetic" or "silkscreen print"
- "limited edition poster art"
- "vintage [decade] movie poster" (60s/70s/80s)

**Composition Techniques** (choose 1-2):
- Centered symmetrical composition
- Silhouette against [color] background
- Negative space storytelling
- Geometric framing (circles, triangles, arches)
- Layered depth with foreground/midground/background

**Color Strategy** (specify clearly):
- Limited palette: "3-color screen print: [color 1], [color 2], [color 3]"
- Duotone: "[warm color] and [cool color] duotone"
- Vintage scheme: "70s palette: burnt orange, mustard yellow, brown"
- High contrast: "bold [color] on [color] background"

**Visual Elements** (symbolic, not literal):
- Key prop or object (weapon, vehicle, iconic item)
- Silhouettes over detailed faces
- Geometric shapes hiding imagery
- Environmental mood (fog, rain, shadows)
- Symbolic animals or nature elements

**Texture & Finish** (adds authenticity):
- "halftone dot texture"
- "risograph printing effect"
- "paper texture grain"
- "slight misalignment between color layers"
- "vintage print imperfections"

## Artist-Specific Variations

For different Mondo artist styles, see [references/artist-styles.md](references/artist-styles.md).

**Quick reference:**
- **Tyler Stout style**: Dense character collages, intricate details, maximal composition
- **Olly Moss style**: Ultra-minimal, clever negative space, 1-2 colors
- **Martin Ansin style**: Art Deco influence, elegant line work, muted vintage tones

## Example Prompts (Optimized for Clean Design)

### Film Noir (Minimal)
```
Detective silhouette in fedora in Mondo poster style, vertical 9:16 portrait,
single centered figure, 3-color screen print: deep blue, cream, red accent,
clean minimalist composition, halftone texture, vintage 1940s aesthetic
```

### Sci-Fi (Minimalist Eye Window)
```
Astronaut helmet visor reflecting alien planet in Mondo poster style, vertical 9:16,
centered circular composition, 3-color screen print: orange, teal, black, single
focal element, negative space storytelling, clean retro 1970s sci-fi aesthetic
```

### Horror (Symbolic Architecture)
```
Victorian mansion single lit window in Mondo poster style, vertical 9:16 portrait,
centered Gothic silhouette, 3-color screen print: black, burgundy, cream, single
focal point, clean simple composition, vintage 1970s horror aesthetic
```

## Advanced Negative Space Techniques

Master-level Mondo designs use **figure-ground inversion** - where the negative space (area without ink) forms meaningful shapes. This creates dual-layered visual experiences with hidden surprises.

### Technique 1: Clever Visual Puns (Olly Moss Style)
**One element serves double duty:**
- Silhouette CONTAINS another scene within negative space
- Background shape IS the story element
- What's NOT shown tells as much as what IS shown

**Example structure:**
```
[Subject silhouette] in Mondo poster style, vertical 9:16, negative space WITHIN
silhouette reveals [hidden element], Olly Moss figure-ground inversion, 2-color
duotone: [color 1] and [color 2], clever dual imagery, what's missing tells the story
```

**Real-world inspiration:**
- Darth Vader silhouette with AT-ST battle scene in negative space
- Detective hat where negative space forms city skyline
- Knife blade reflecting villain's silhouette

### Technique 2: Scale Contrast Drama
**Tiny vs. Massive creates emotional impact:**
- Small human figure + giant object/creature
- Emphasizes isolation, wonder, or threat
- Uses 70% negative space for breathing room

**Example structure:**
```
Tiny [subject] with massive [object] looming in Mondo poster style, vertical 9:16,
dramatic scale contrast, [subject] occupies only bottom 20%, vast negative space
above, 2-3 color screen print, sense of [emotion: awe/isolation/danger]
```

### Technique 3: Single Shape Storytelling
**ONE iconic shape captures entire narrative:**
- No clutter, no multiple elements
- Let one perfect symbol do ALL the work
- 30% graphic, 30% text, 40% empty space (2024 best practice)

**Example structure:**
```
Single [iconic object/symbol] centered in Mondo poster style, vertical 9:16,
ONLY this one element, surrounded by vast negative space, 2-color print:
[color 1] on [color 2] background, Olly Moss ultra-minimal approach, one
image tells complete story
```

## Proven Success Patterns

Based on successful generations, these patterns consistently deliver exceptional results:

### Pattern 1: Single Focal Point (Minimalist Clean)
**Key principles:**
- ONE central element only (eye, object, silhouette)
- Vertical 9:16 format
- 2-3 colors maximum
- Negative space around focal point
- Clean, uncluttered, iconic

**Simplified structure:**
```
[Single element] in Mondo poster style, vertical 9:16, centered single focal point,
3-color screen print: [color 1], [color 2], [color 3], clean minimalist composition,
vintage [decade] aesthetic, simple and iconic
```

### Pattern 2: Atmospheric Single Subject (Clean Layered)
**Key principles:**
- ONE main subject with simple background
- Vertical 9:16 format
- 3-4 colors for atmosphere
- Subject in foreground, simple backdrop
- Clean composition, not cluttered

**Simplified structure:**
```
[Main subject] in Mondo poster style, vertical 9:16, single subject with [simple backdrop],
3-color screen print: [atmospheric colors], clean composition, vintage [decade] aesthetic,
focused and simple
```

## Workflow

1. **Identify the subject** - Film, book, album, band, event, or concept
2. **Choose symbolic element** - What single image captures the essence?
3. **Select composition pattern** - Minimalist symbolic OR layered atmospheric
4. **Select color palette** - 2-4 colors max, high contrast, vintage-inspired
5. **Add texture keywords** - Screen print, halftone, risograph effects
6. **Set the era** - Specify 60s/70s/80s for period-accurate aesthetics

## Tips for Best Results

**Do:**
- Specify exact color names and counts ("3-color: burnt orange, cream, navy")
- Use geometric composition terms (centered, symmetrical, negative space)
- Reference specific decades for vintage accuracy
- Emphasize symbolic over literal elements
- Include texture/printing process keywords

**Don't:**
- Use photorealistic or digital gradient terms
- Request complex facial details (use silhouettes instead)
- Mix too many styles (keep it focused on screen print aesthetic)
- Forget the vintage era context (60s-80s is key)
- Overlook negative space opportunities

## Advanced: Format-Specific Approaches

For detailed format and genre-specific templates:
- [references/genre-templates.md](references/genre-templates.md) - Horror, Sci-Fi, Western, Noir, etc.
- [references/composition-patterns.md](references/composition-patterns.md) - Layout strategies and visual hierarchy
- [references/book-covers.md](references/book-covers.md) - Book cover design patterns and best practices
- [references/artist-styles.md](references/artist-styles.md) - Tyler Stout, Olly Moss, Martin Ansin, etc.

## 🚀 Enhanced Features (NEW!)

### 1. AI-Powered Prompt Optimization

Let AI enhance your prompt while **respecting your original intent**:

```bash
python3 scripts/generate_mondo_enhanced.py "Blade Runner" movie --ai-enhance
```

**How it works:**
- Takes your original idea
- Adds ONE perfect symbolic element
- Suggests complementary colors (you can override)
- Uses negative space techniques
- Keeps it clean and minimal

**Example:**
```bash
# Your input: "Inception movie"
# AI enhances to: "Spinning top floating in Mondo poster style, vertical 9:16,
# single iconic object, negative space reveals dream layers, 2-color duotone:
# gold and deep blue, Olly Moss minimal approach"
```

### 2. Three-Column Style Comparison

Generate 3 different styles side-by-side to choose the best:

```bash
python3 scripts/generate_mondo_enhanced.py "Dune" movie --compare saul-bass,olly-moss,kilian-eng
```

**Perfect for:**
- Exploring different artistic approaches
- Client presentations
- Finding the best style for your subject

### 3. Image-to-Image Transformation

Transform existing posters into Mondo style:

```bash
python3 scripts/generate_mondo_enhanced.py "noir thriller" movie --input original_poster.jpg --style saul-bass
```

**Use cases:**
- Convert photographic posters to illustrated style
- Apply Mondo aesthetic to existing designs
- Reimagine classic posters

### 4. 20 Greatest Poster Artists

Now includes 20 legendary artist styles:

**Belle Époque Pioneers:**
- `jules-cheret` - Bright joyful colors, dynamic feminine figures
- `toulouse-lautrec` - Flat blocks, Japanese influence, bold silhouettes
- `alphonse-mucha` - Art Nouveau flowing curves, ornate floral
- `steinlen` - Social realist, expressive lines, cat motifs
- `eugène-grasset` - Medieval Gothic, stained glass aesthetic

**Modernist Masters:**
- `saul-bass` - Minimalist geometric abstraction, visual metaphors
- `cassandre` - Cubist planes, dramatic perspective, Art Deco
- `milton-glaser` - Psychedelic pop art, innovative typography
- `josef-muller-brockmann` - Swiss grid, mathematical precision
- `paul-rand` - Playful geometry, clever visual puns

**Film Legends:**
- `drew-struzan` - Painted realism, epic cinematic, nostalgic glow
- `olly-moss` - Ultra-minimal negative space, hidden imagery
- `tyler-stout` - Maximalist collages, intricate details
- `martin-ansin` - Art Deco elegance, refined vintage
- `laurent-durieux` - Visual puns, mysterious atmospheric

**Contemporary:**
- `kilian-eng` - Geometric futurism, precise technical lines
- `dan-mccarthy` - Ultra-flat geometric abstraction
- `jock` - Gritty expressive brushwork, dynamic action
- `shepard-fairey` - Propaganda style, halftone, political
- `jay-ryan` - Folksy handmade, warm textured simple
- `paula-scher` - Typographic maximalism, layered text

**View all styles:**
```bash
python3 scripts/generate_mondo_enhanced.py --list-styles
```

### 5. Smart Color Suggestions

AI suggests complementary colors, but you can override:

```bash
# Let AI suggest colors
python3 scripts/generate_mondo_enhanced.py "Jazz Festival" event --style jules-cheret

# Or specify your own
python3 scripts/generate_mondo_enhanced.py "Jazz Festival" event --style jules-cheret --colors "vibrant yellow, deep blue, red"
```

## Interactive Usage with Claude

When using this skill through Claude Code, I can guide you interactively:

**I'll ask you simple questions like:**
1. "What's your subject?" (movie/book/album title)
2. "Which style feels right?" (show 3-4 options with previews)
3. "Any color preferences?" (or let AI suggest)
4. "Want to see comparisons?" (generate 3 versions)

This makes it easy even if you're unfamiliar with Mondo aesthetics!

---

## Direct Image Generation

This skill can generate actual images directly using the bundled scripts:

### Enhanced Version (Recommended)

**Full feature set:** AI enhancement, comparisons, image-to-image, 20 artists

```bash
python3 scripts/generate_mondo_enhanced.py "subject" "type" [options]
```

**Enhanced Parameters:**
- `subject`: What to design
- `type`: Design type - "movie", "book", "album", "event"
- `--style`: Artist style (20 options, see --list-styles)
- `--ai-enhance`: Let AI optimize prompt (respects your intent)
- `--compare`: Generate 3-style comparison (e.g., "saul-bass,olly-moss,jock")
- `--input`: Input image for image-to-image transformation
- `--colors`: Color preferences (e.g., "orange, teal, black")
- `--aspect-ratio`: Aspect ratio (default: 9:16)
- `--output`: Custom output path
- `--no-generate`: Only show prompt

**Enhanced Examples:**

AI-optimized generation:
```bash
python3 scripts/generate_mondo_enhanced.py "Blade Runner" movie --ai-enhance
```

3-style comparison:
```bash
python3 scripts/generate_mondo_enhanced.py "Akira" movie --compare kilian-eng,saul-bass,jock
```

Image-to-image with specific artist:
```bash
python3 scripts/generate_mondo_enhanced.py "cyberpunk noir" movie --input poster.jpg --style saul-bass
```

With color preferences:
```bash
python3 scripts/generate_mondo_enhanced.py "Jazz Night" event --style milton-glaser --colors "psychedelic orange, purple, yellow"
```

List all 20 artist styles:
```bash
python3 scripts/generate_mondo_enhanced.py --list-styles
```

### Standard Version (Simple & Fast)

**Basic usage for quick generation:**

```bash
python3 scripts/generate_mondo.py "subject" "type" [options]
```

**Parameters:**
- `subject`: What to design (e.g., "Neuromancer cyberpunk novel", "Jazz concert poster")
- `type`: Design type - "movie", "book", "album", "event"
- `--aspect-ratio` / `--ratio`: Aspect ratio (default: **9:16** for mobile/social media)
  - Common ratios: 9:16 (vertical mobile), 16:9 (horizontal), 1:1 (square), 2:3, 3:2, 4:5
- `--style`: Artist style - "olly-moss", "tyler-stout", "minimal", "atmospheric" (default: auto)
- `--output`: Custom output path (default: outputs/)
- `--no-generate`: Only create prompt without generating image

**Why 9:16 Default?**
- Optimized for modern mobile devices and social media (Instagram Stories, TikTok, Reels)
- Better vertical composition for posters and book covers
- Maximizes screen space on smartphones

**Examples:**

Movie poster (default 9:16 vertical):
```bash
python3 scripts/generate_mondo.py "Akira cyberpunk anime" "movie"
```

Book cover with minimal style (9:16):
```bash
python3 scripts/generate_mondo.py "1984 dystopian novel" "book" --style minimal
```

Album cover with square ratio:
```bash
python3 scripts/generate_mondo.py "Pink Floyd The Wall progressive rock" "album" --aspect-ratio 1:1
```

Horizontal cinema poster:
```bash
python3 scripts/generate_mondo.py "Western film Sergio Leone" "movie" --aspect-ratio 16:9
```

Custom ratio for print:
```bash
python3 scripts/generate_mondo.py "Jazz Festival poster" "event" --ratio 2:3 --style atmospheric
```

Generate prompt only (no image):
```bash
python3 scripts/generate_mondo.py "Dune sci-fi epic" "movie" --no-generate
```

### Manual Generation

If you prefer to generate prompts manually and use other image generation tools:

1. Use this skill to generate the Mondo-style prompt
2. Pass the prompt to:
   - `/generate-image` - AI Gateway API (recommended)
   - `/ai-image-generation` - FLUX, Gemini, and other models
   - `/qiaomu-image-generator` - For article/content illustrations

**Recommended settings:**
- Model: `google/gemini-3.1-flash-image-preview` (best quality/speed balance)
- Resolution: 2K or higher for print quality
- Format: PNG with transparency support
