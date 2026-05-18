"""
Korekcyjna analiza obrazu - precyzyjne wycięcia dla książek z prawej strony półki.
Na podstawie analizy wizualnej, korekta pozycji.
"""

from PIL import Image, ImageEnhance, ImageFilter, ImageOps
import numpy as np
import os
from pathlib import Path

# Ścieżki
IMAGE_PATH = r"C:\Projekty\10xDevs\photos\20260512_230159.jpg"
OUTPUT_DIR = Path("docs/image-analysis")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def load_image():
    img = Image.open(IMAGE_PATH)
    print(f"Wymiary obrazu: {img.size[0]}x{img.size[1]} px")
    return img

def cut_fragment(img, x1, x2, y1, y2, label=""):
    """Wycina fragment na podstawie pikseli."""
    fragment = img.crop((x1, y1, x2, y2))
    print(f"  {label}: ({x1},{y1})-({x2},{y2}) -> {fragment.size[0]}x{fragment.size[1]}")
    return fragment

def enhance_all(fragment, book_num):
    """Zastosuj wszystkie metody enhancement i zapisz."""
    w, h = fragment.size
    scale = 3
    
    # Oryginał
    fragment.save(OUTPUT_DIR / f"book{book_num}_v2_original.png")
    
    # Powiększenie
    enlarged = fragment.resize((w*scale, h*scale), Image.LANCZOS)
    enlarged.save(OUTPUT_DIR / f"book{book_num}_v2_enlarged.png")
    
    # Kontrast + jasność + sharpening
    combo = enhance_contrast(fragment, 2.0)
    combo = enhance_brightness(combo, 1.5)
    combo = sharpen_unsharp_mask(combo, 1.5, 200)
    combo_resized = combo.resize((w*scale, h*scale), Image.LANCZOS)
    combo_resized.save(OUTPUT_DIR / f"book{book_num}_v2_combo.png")
    
    # Grayscale + kontrast
    gray = fragment.convert('L')
    gray_c = ImageEnhance.Contrast(gray).enhance(2.5)
    gray_c_resized = gray_c.resize((w*scale, h*scale), Image.LANCZOS)
    gray_c_resized.save(OUTPUT_DIR / f"book{book_num}_v2_grayscale.png")
    
    # Autocontrast
    auto_c = ImageOps.autocontrast(fragment)
    auto_c_resized = auto_c.resize((w*scale, h*scale), Image.LANCZOS)
    auto_c_resized.save(OUTPUT_DIR / f"book{book_num}_v2_autocontrast.png")
    
    print(f"  Zapisano pliki dla książki {book_num}")

def enhance_contrast(img, factor=1.8):
    enhancer = ImageEnhance.Contrast(img)
    return enhancer.enhance(factor)

def enhance_brightness(img, factor=1.5):
    enhancer = ImageEnhance.Brightness(img)
    return enhancer.enhance(factor)

def sharpen_unsharp_mask(img, radius=2.0, percent=150):
    blurred = img.filter(ImageFilter.GaussianBlur(radius))
    factor = percent / 100.0
    arr_orig = np.array(img)
    arr_blur = np.array(blurred)
    arr_result = arr_orig + (arr_orig - arr_blur) * factor
    arr_result = np.clip(arr_result, 0, 255).astype(np.uint8)
    return Image.fromarray(arr_result)

def main():
    print("Ładowanie obrazu...")
    img = load_image()
    w, h = img.size
    
    # Na podstawie analizy wizualnej - precyzyjne piksele
    # Książki z prawej strony (od lewej do prawej w tej grupie):
    # 1. Zielona Burza część 2 (fioletowa) - Philip Reeve
    # 2. Zielona Burza część 1 (żółta) - Philip Reeve
    # 3. Cynowiec (pomarańczowa) - Philip Reeve
    # 4. Kosmos (zielona) - Neil deGrasse Tyson
    # 5. Osadnicy/Catcatcher (czerwono-brązowa) - Rebecca Roanhorse
    
    # Węzłowe punkty (szacunkowe na podstawie obrazu 4000x1848):
    # Półka zaczyna się ok. y=350 i kończy ok. y=1500
    
    books = [
        # (nr, x1, x2, opis)
        (21, 3200, 3300, "Zielona Burza część 2 - Philip Reeve (fioletowa)"),
        (22, 3300, 3400, "Zielona Burza część 1 - Philip Reeve (żółta)"),
        (23, 3400, 3520, "Cynowiec - Philip Reeve (pomarańczowa)"),
        (24, 3520, 3650, "Kosmos - Neil deGrasse Tyson (zielona)"),
        (25, 3650, 4000, "Osadnicy/Catcatcher - Rebecca Roanhorse (czerwono-brązowa)"),
    ]
    
    for book_num, x1, x2, desc in books:
        print(f"\n{'='*60}")
        print(f"Książka {book_num}: {desc}")
        print(f"{'='*60}")
        fragment = cut_fragment(img, x1, x2, 350, 1500, f"nr{book_num}")
        enhance_all(fragment, book_num)
    
    print("\n\nUkończono!")

if __name__ == "__main__":
    main()
