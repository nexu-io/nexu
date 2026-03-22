#!/usr/bin/env python3
"""
Mondo Style Design Generator - Enhanced Version
Features: Claude-generated prompts, 3-column comparison, image-to-image, 20 artist styles
"""

import os
import sys
import argparse
import json
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import io

# API Configuration - PipeLLM Gemini
PIPELLM_BASE_URL = 'https://api.pipellm.ai'
DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image-preview'   # 高质量图片模型

# 30+ Design Styles: Poster Artists + Book Cover + Album Cover + Social Media
ARTIST_STYLES = {
    "auto": "let AI choose best style",
    # === Poster Artists (20) ===
    "saul-bass": "Saul Bass minimalist geometric abstraction, 2-3 colors, visual metaphor",
    "olly-moss": "Olly Moss ultra-minimal negative space, clever hidden imagery, 2 colors",
    "tyler-stout": "Tyler Stout maximalist character collage, intricate line work, organized chaos",
    "martin-ansin": "Martin Ansin Art Deco elegance, refined vintage palette, sophisticated",
    "toulouse-lautrec": "Toulouse-Lautrec flat color blocks, Japanese influence, bold silhouettes",
    "alphonse-mucha": "Alphonse Mucha Art Nouveau flowing curves, ornate floral, decorative borders",
    "jules-cheret": "Jules Chéret Belle Époque bright joyful colors, dynamic feminine figures",
    "cassandre": "Cassandre modernist geometry, Cubist planes, dramatic perspective, Art Deco",
    "milton-glaser": "Milton Glaser psychedelic pop art, innovative typography, vibrant colors",
    "drew-struzan": "Drew Struzan painted realism, epic cinematic, warm nostalgic glow",
    "kilian-eng": "Kilian Eng geometric futurism, precise technical lines, cool sci-fi palette",
    "laurent-durieux": "Laurent Durieux visual puns, hidden imagery, mysterious atmospheric",
    "jay-ryan": "Jay Ryan folksy handmade, single focal image, warm textured simple",
    "dan-mccarthy": "Dan McCarthy ultra-flat geometric abstraction, 2-3 solid colors, no gradients",
    "jock": "Jock gritty expressive brushwork, dynamic action, high contrast, raw energy",
    "shepard-fairey": "Shepard Fairey propaganda style, red black cream, halftone, political",
    "steinlen": "Steinlen social realist, expressive lines, cat motifs, high contrast",
    "josef-muller-brockmann": "Josef Müller-Brockmann Swiss grid, Helvetica, mathematical precision",
    "paul-rand": "Paul Rand playful geometry, clever visual puns, witty intelligent",
    "paula-scher": "Paula Scher typographic maximalism, layered text, vibrant expressive letters",
    # === Book Cover Designers (6) ===
    "chip-kidd": "Chip Kidd conceptual book cover, single symbolic object, bold typography, photographic metaphor, witty visual pun, Random House literary aesthetic",
    "peter-mendelsund": "Peter Mendelsund abstract literary cover, deconstructed typography, minimal symbolic elements, intellectual negative space, Knopf literary elegance",
    "coralie-bickford-smith": "Coralie Bickford-Smith Penguin Clothbound Classics, repeating decorative patterns, Art Nouveau foil stamping, jewel-tone palette, ornamental borders, fabric texture",
    "david-pearson": "David Pearson Penguin Great Ideas, bold typographic-only cover, text as visual element, minimal color, intellectual and clean, type-driven design",
    "wang-zhi-hong": "Wang Zhi-Hong East Asian book design, restrained elegant typography, confident negative space, subtle texture, balanced asymmetry, literary sophistication",
    "jan-tschichold": "Jan Tschichold modernist Penguin typography, Swiss precision grid, clean serif fonts, understated elegance, timeless typographic hierarchy",
    # === Album Cover Designers (3) ===
    "reid-miles": "Reid Miles Blue Note Records, bold asymmetric typography, high contrast black and single accent color, jazz photography silhouette, dramatic negative space, vintage vinyl",
    "david-stone-martin": "David Stone Martin Verve Records, single gestural ink brushstroke, minimalist line drawing on cream, fluid calligraphic lines, maximum negative space, improvisational energy",
    "peter-saville": "Peter Saville Factory Records extreme minimalism, single abstract form in vast empty space, monochromatic, no text on cover, conceptual and mysterious, intellectual restraint",
    # === Social Media / Chinese Aesthetic Styles (4) ===
    "wenyi": "文艺风 literary artistic style, soft muted tones, generous white space, delicate serif typography, watercolor texture, poetic atmosphere, refined and contemplative, editorial book review aesthetic",
    "guochao": "国潮风 Chinese contemporary trend, traditional Chinese motifs reimagined modern, bold red and gold palette, ink wash meets graphic design, cultural symbols with street art energy, 新中式",
    "rixi": "日系 Japanese aesthetic, warm film grain, soft natural light, pastel muted palette, clean minimal layout, hand-drawn accents, cozy atmosphere, wabi-sabi imperfection, zakka lifestyle",
    "hanxi": "韩系 Korean aesthetic, clean bright pastel, soft gradient backgrounds, modern sans-serif typography, dreamy ethereal quality, sophisticated minimal, Instagram-worthy composition",
    # === Generic Styles ===
    "minimal": "minimalist, centered single focal point, 2-3 color palette, clean simple",
    "atmospheric": "single strong focal element with atmospheric background, 3-4 colors",
    "negative-space": "figure-ground inversion, negative space reveals hidden element, 2 colors"
}

def get_genai_client():
    """创建 PipeLLM google-genai 客户端"""
    from google import genai
    api_key = os.getenv('PIPELLM_API_KEY')
    if not api_key:
        print("Error: PIPELLM_API_KEY environment variable is required.")
        print("Please set: export PIPELLM_API_KEY=your_key")
        sys.exit(1)
    return genai.Client(
        api_key=api_key,
        http_options={"base_url": PIPELLM_BASE_URL}
    )


def get_format_description(aspect_ratio):
    """Get format description text matching the aspect ratio"""
    ratio_descriptions = {
        "9:16": "vertical 9:16 portrait format",
        "16:9": "horizontal 16:9 landscape format, wide cinematic composition",
        "21:9": "ultra-wide 21:9 panoramic banner format, horizontal landscape",
        "3:4": "vertical 3:4 portrait format",
        "4:3": "horizontal 4:3 landscape format",
        "1:1": "square 1:1 format",
    }
    return ratio_descriptions.get(aspect_ratio, f"{aspect_ratio} format")

def generate_prompt(subject, design_type, style="auto", color_hint="", aspect_ratio="9:16"):
    """
    Generate Mondo-style prompt from subject.
    When called by Claude, pass a rich pre-crafted prompt as subject for best results.

    Args:
        subject: The subject matter (or a fully-crafted Mondo prompt from Claude)
        design_type: Type of design ("movie", "book", "album", "event")
        style: Visual style (artist name or preset)
        color_hint: Optional color preferences from user
        aspect_ratio: Aspect ratio for the image

    Returns:
        Generated prompt string
    """
    format_desc = get_format_description(aspect_ratio)

    # Standard template path
    base_elements = "Mondo poster style, screen print aesthetic, limited edition poster art"

    # Get style modifier
    style_desc = ARTIST_STYLES.get(style, ARTIST_STYLES['minimal'])

    # Build prompt based on type
    if design_type == "movie":
        prompt = f"{subject} in {base_elements}, {style_desc}, {format_desc}, clean focused composition, vintage poster aesthetic"
    elif design_type == "book":
        prompt = f"{subject} book cover in {base_elements}, {style_desc}, {format_desc}, clean typography, literary design"
    elif design_type == "album":
        prompt = f"{subject} album cover in {base_elements}, {style_desc}, square 1:1 format, vintage vinyl aesthetic"
    elif design_type == "event":
        prompt = f"{subject} event poster in {base_elements}, {style_desc}, {format_desc}, bold memorable design"
    else:
        prompt = f"{subject} in {base_elements}, {style_desc}, vintage print aesthetic"

    # Add color hint if provided
    if color_hint:
        prompt += f", color palette: {color_hint}"

    return prompt

def generate_image(prompt, output_path=None, model=DEFAULT_IMAGE_MODEL, aspect_ratio="9:16", input_image=None):
    """使用 PipeLLM Gemini 生成图片"""
    client = get_genai_client()

    print(f"🎨 Generating with {model}")
    print(f"✍️  Prompt: {prompt[:80]}..." if len(prompt) > 80 else f"✍️  Prompt: {prompt}")
    print("⏳ Please wait...\n")

    contents = [prompt]

    # 图生图：把输入图片也传给模型
    if input_image and os.path.exists(input_image):
        try:
            from google.genai import types
            with open(input_image, 'rb') as f:
                img_bytes = f.read()
            pil_img = Image.open(io.BytesIO(img_bytes))
            contents = [
                types.Part.from_bytes(data=img_bytes, mime_type="image/png"),
                f"Transform this image in Mondo poster style: {prompt}"
            ]
            print(f"📷 Using input image: {input_image}")
        except Exception as e:
            print(f"⚠ Could not load input image: {e}, ignoring")

    try:
        response = client.models.generate_content(
            model=model,
            contents=contents,
        )

        # 提取图片 part
        image_part = None
        for part in response.parts:
            if part.inline_data is not None:
                image_part = part
                break

        if image_part is None:
            print("❌ No image data in response")
            return None

        if not output_path:
            timestamp = datetime.now().strftime('%Y-%m-%d-%H-%M-%S')
            default_dir = os.path.expanduser("~/乔木新知识库/60-69 素材/61 AI图片/mondo-designs")
            os.makedirs(default_dir, exist_ok=True)
            output_path = f"{default_dir}/mondo-{timestamp}.png"

        os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else '.', exist_ok=True)
        img = image_part.as_image()
        img.save(output_path)
        print(f"✅ Saved to {output_path}")
        return output_path

    except Exception as e:
        print(f"❌ Error: {e}")
        return None

def generate_comparison(subject, design_type, styles, aspect_ratio="9:16", colors=""):
    """
    Generate 3-column comparison of different styles

    Args:
        subject: Subject matter
        design_type: Type of design
        styles: List of 3 style names
        aspect_ratio: Aspect ratio
        colors: Optional color hint

    Returns:
        Path to comparison image
    """
    print(f"\n{'='*80}")
    print(f"🎨 GENERATING 3-STYLE COMPARISON")
    print(f"{'='*80}\n")

    images = []
    labels = []

    for i, style in enumerate(styles, 1):
        print(f"\n[{i}/3] Generating {style} style...")
        prompt = generate_prompt(subject, design_type, style, color_hint=colors, aspect_ratio=aspect_ratio)

        timestamp = datetime.now().strftime('%Y-%m-%d-%H-%M-%S')
        temp_path = f"outputs/temp-{style}-{timestamp}.png"

        result = generate_image(prompt, temp_path, aspect_ratio=aspect_ratio)
        if result:
            images.append(result)
            labels.append(style)
        else:
            print(f"⚠ Failed to generate {style}, skipping")

    if len(images) < 2:
        print("❌ Not enough images generated for comparison")
        return None

    # Create side-by-side comparison
    try:
        pil_images = [Image.open(img) for img in images]

        # Resize to same height
        target_height = min(img.height for img in pil_images)
        pil_images = [img.resize((int(img.width * target_height / img.height), target_height))
                     for img in pil_images]

        # Create comparison canvas
        total_width = sum(img.width for img in pil_images) + (len(pil_images) - 1) * 20  # 20px spacing
        comparison = Image.new('RGB', (total_width, target_height + 50), 'white')
        draw = ImageDraw.Draw(comparison)

        # Paste images side by side
        x_offset = 0
        for i, (img, label) in enumerate(zip(pil_images, labels)):
            comparison.paste(img, (x_offset, 0))

            # Add label
            label_text = label.upper().replace('-', ' ')
            bbox = draw.textbbox((0, 0), label_text)
            text_width = bbox[2] - bbox[0]
            text_x = x_offset + (img.width - text_width) // 2
            draw.text((text_x, target_height + 15), label_text, fill='black')

            x_offset += img.width + 20

        # Save comparison
        timestamp = datetime.now().strftime('%Y-%m-%d-%H-%M-%S')
        comparison_path = f"outputs/comparison-{timestamp}.png"
        comparison.save(comparison_path)

        # Clean up temp files
        for img_path in images:
            try:
                os.remove(img_path)
            except:
                pass

        print(f"\n✅ Comparison saved to {comparison_path}")
        return comparison_path

    except Exception as e:
        print(f"❌ Error creating comparison: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(
        description='Enhanced Mondo Style Design Generator with AI optimization, comparison mode, and 20 artist styles',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
🎨 20 Artist Styles Available:
  Classic: saul-bass, toulouse-lautrec, alphonse-mucha, jules-cheret, cassandre
  Modern: olly-moss, tyler-stout, martin-ansin, drew-struzan, milton-glaser
  Contemporary: kilian-eng, dan-mccarthy, jock, shepard-fairey, jay-ryan

Examples:
  # AI-enhanced prompt (respects your original idea)
  python3 generate_mondo_enhanced.py "Blade Runner" movie --ai-enhance

  # 3-style comparison
  python3 generate_mondo_enhanced.py "Dune" movie --compare saul-bass,olly-moss,kilian-eng

  # Image-to-image transformation
  python3 generate_mondo_enhanced.py "noir thriller" movie --input poster.jpg --style saul-bass

  # With color preferences
  python3 generate_mondo_enhanced.py "Jazz Festival" event --style jules-cheret --colors "vibrant yellow, deep blue, red"

  # Specific artist style
  python3 generate_mondo_enhanced.py "Akira" movie --style kilian-eng
        """
    )

    parser.add_argument('subject', help='Subject matter (e.g., "Blade Runner", "1984 novel")')
    parser.add_argument('type', choices=['movie', 'book', 'album', 'event'],
                       help='Type of design to create')
    parser.add_argument('--style', choices=list(ARTIST_STYLES.keys()), default='auto',
                       help='Artist style (default: auto)')
    parser.add_argument('--compare', type=str,
                       help='Generate 3-style comparison (comma-separated, e.g., "saul-bass,olly-moss,jock")')
    parser.add_argument('--input', type=str,
                       help='Input image for image-to-image transformation')
    parser.add_argument('--colors', type=str, default='',
                       help='Color preferences (e.g., "orange, teal, black")')
    parser.add_argument('--aspect-ratio', '--ratio', dest='aspect_ratio', default='9:16',
                       help='Aspect ratio (default: 9:16)')
    parser.add_argument('--output', help='Output file path')
    parser.add_argument('--model', default=DEFAULT_IMAGE_MODEL, help='Model to use')
    parser.add_argument('--no-generate', action='store_true',
                       help='Only show prompt without generating')
    parser.add_argument('--list-styles', action='store_true',
                       help='List all available artist styles')

    args = parser.parse_args()

    # List styles
    if args.list_styles:
        print("\n🎨 20 Greatest Poster Artists - Available Styles:\n")
        for style, desc in ARTIST_STYLES.items():
            print(f"  {style:25} → {desc}")
        print()
        return

    # Comparison mode
    if args.compare:
        styles = [s.strip() for s in args.compare.split(',')]
        if len(styles) != 3:
            print("❌ Comparison requires exactly 3 styles (e.g., --compare saul-bass,olly-moss,jock)")
            sys.exit(1)

        generate_comparison(args.subject, args.type, styles, args.aspect_ratio, args.colors)
        return

    # Single generation mode
    prompt = generate_prompt(args.subject, args.type, args.style, args.colors, args.aspect_ratio)

    print(f"\n{'='*80}")
    print("🎨 MONDO POSTER PROMPT")
    print(f"{'='*80}")
    print(f"{prompt}")
    print(f"{'='*80}\n")

    if not args.no_generate:
        output_path = generate_image(prompt, args.output, args.model, args.aspect_ratio, args.input)
        if not output_path:
            sys.exit(1)
    else:
        print("✓ Prompt generated. Use without --no-generate to create image.")

if __name__ == '__main__':
    main()
