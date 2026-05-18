"""
Zaawansowana analiza obrazu książek z półki.
Wycina fragmenty z problematycznymi książkami i stosuje techniki poprawy czytelności.
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
    """Wczytaj obraz i zwróć wymiary."""
    img = Image.open(IMAGE_PATH)
    print(f"Wymiary obrazu: {img.size[0]}x{img.size[1]} px")
    return img

def cut_fragment(img, x_pct_start, x_pct_end, y_pct_start=0, y_pct_end=100, label=""):
    """Wycina fragment obrazu na podstawie procentów pozycji."""
    w, h = img.size
    x1 = int(w * x_pct_start / 100)
    x2 = int(w * x_pct_end / 100)
    y1 = int(h * y_pct_start / 100)
    y2 = int(h * y_pct_end / 100)
    fragment = img.crop((x1, y1, x2, y2))
    print(f"  {label}: ({x1},{y1})-({x2},{y2}) -> {fragment.size[0]}x{fragment.size[1]}")
    return fragment

def apply_clahe(img, clip_limit=3.0):
    """CLAHE - Contrast Limited Adaptive Histogram Equalization."""
    # Konwersja do LAB i aplikowanie CLAHE na kanał L
    img_arr = np.array(img.convert('LAB'))
    l, a, b = img_arr[:,:,0], img_arr[:,:,1], img_arr[:,:,2]
    
    # CLAHE na kanał jasności
    from PIL import Image
    l_img = Image.fromarray(l)
    # Manual CLAHE-like approach
    equalized = ImageOps.autocontrast(l_img, cutoff=5)
    l_eq = np.array(equalized)
    
    result = np.stack([l_eq, a, b], axis=-1)
    return Image.fromarray(result, 'LAB').convert('RGB')

def enhance_contrast(img, factor=1.8):
    """Zwiększa kontrast."""
    enhancer = ImageEnhance.Contrast(img)
    return enhancer.enhance(factor)

def enhance_brightness(img, factor=1.5):
    """Zwiększa jasność."""
    enhancer = ImageEnhance.Brightness(img)
    return enhancer.enhance(factor)

def enhance_sharpness(img, factor=2.0):
    """Wyostrza obraz."""
    enhancer = ImageEnhance.Sharpness(img)
    return enhancer.enhance(factor)

def enhance_color(img, factor=1.5):
    """Zwiększa saturację kolorów."""
    enhancer = ImageEnhance.Color(img)
    return enhancer.enhance(factor)

def sharpen_unsharp_mask(img, radius=2.0, percent=150):
    """Unsharp mask filtering."""
    blurred = img.filter(ImageFilter.GaussianBlur(radius))
    # Unsharp mask: original + (original - blurred) * factor
    factor = percent / 100.0
    result = Image.blend(img, img, 0)  # copy
    arr_orig = np.array(img)
    arr_blur = np.array(blurred)
    arr_result = arr_orig + (arr_orig - arr_blur) * factor
    arr_result = np.clip(arr_result, 0, 255).astype(np.uint8)
    return Image.fromarray(arr_result)

def binary_segmentation(img, threshold=128):
    """Binarna segmentacja tekstu."""
    gray = img.convert('L')
    # Invert so text is white on black
    inverted = ImageOps.invert(gray)
    # Threshold
    enhanced = inverted.point(lambda x: 255 if x > threshold else 0)
    return enhanced

def deskew_and_enlarge(img, scale=3):
    """Powiększa obraz dla lepszej czytelności."""
    w, h = img.size
    new_size = (w * scale, h * scale)
    return img.resize(new_size, Image.LANCZOS)

def auto_contrast_stretch(img):
    """Auto contrast stretching."""
    return ImageOps.autocontrast(img)

def equalize_histogram(img):
    """Histogram equalization."""
    return ImageOps.equalize(img)

def process_book_fragment(img, book_num, x_start, x_end, y_start=15, y_end=85):
    """Przetwarza fragment książki z wieloma technikami."""
    label = f"nr{book_num} ({x_start}-{x_end}%)"
    print(f"\n{'='*60}")
    print(f"Przetwarzanie: {label}")
    print(f"{'='*60}")
    
    # Wycięcie fragmentu
    fragment = cut_fragment(img, x_start, x_end, y_start, y_end, label)
    
    # Zapisz oryginalny fragment
    orig_path = OUTPUT_DIR / f"book{book_num}_original.png"
    fragment.save(orig_path)
    
    # Powiększenie dla lepszej analizy
    enlarged = deskew_and_enlarge(fragment, scale=4)
    enlarged_path = OUTPUT_DIR / f"book{book_num}_enlarged.png"
    enlarged.save(enlarged_path)
    
    # 1. CLAHE
    clahe = apply_clahe(fragment)
    clahe_enlarged = deskew_and_enlarge(clahe, scale=4)
    clahe_path = OUTPUT_DIR / f"book{book_num}_clahe.png"
    clahe_enlarged.save(clahe_path)
    
    # 2. Kontrast
    contrast = enhance_contrast(fragment, factor=2.0)
    contrast_enlarged = deskew_and_enlarge(contrast, scale=4)
    contrast_path = OUTPUT_DIR / f"book{book_num}_contrast.png"
    contrast_enlarged.save(contrast_path)
    
    # 3. Jasność
    brightness = enhance_brightness(fragment, factor=1.8)
    brightness_enlarged = deskew_and_enlarge(brightness, scale=4)
    brightness_path = OUTPUT_DIR / f"book{book_num}_brightness.png"
    brightness_enlarged.save(brightness_path)
    
    # 4. Kolor/Saturacja
    color = enhance_color(fragment, factor=2.0)
    color_enlarged = deskew_and_enlarge(color, scale=4)
    color_path = OUTPUT_DIR / f"book{book_num}_color.png"
    color_enlarged.save(color_path)
    
    # 5. Sharpening
    sharp = sharpen_unsharp_mask(fragment, radius=1.5, percent=200)
    sharp_enlarged = deskew_and_enlarge(sharp, scale=4)
    sharp_path = OUTPUT_DIR / f"book{book_num}_sharpen.png"
    sharp_enlarged.save(sharp_path)
    
    # 6. Binary segmentation
    binary = binary_segmentation(fragment, threshold=100)
    binary_enlarged = deskew_and_enlarge(binary, scale=4)
    binary_path = OUTPUT_DIR / f"book{book_num}_binary.png"
    binary_enlarged.save(binary_path)
    
    # 7. Auto contrast
    auto_c = auto_contrast_stretch(fragment)
    auto_c_enlarged = deskew_and_enlarge(auto_c, scale=4)
    auto_c_path = OUTPUT_DIR / f"book{book_num}_autocontrast.png"
    auto_c_enlarged.save(auto_c_path)
    
    # 8. Histogram equalization
    eq = equalize_histogram(fragment)
    eq_enlarged = deskew_and_enlarge(eq, scale=4)
    eq_path = OUTPUT_DIR / f"book{book_num}_equalize.png"
    eq_enlarged.save(eq_path)
    
    # 9. Kombinacja: kontrast + sharpening + jasność
    combo = enhance_contrast(fragment, 2.0)
    combo = enhance_brightness(combo, 1.5)
    combo = sharpen_unsharp_mask(combo, 1.5, 200)
    combo_enlarged = deskew_and_enlarge(combo, scale=4)
    combo_path = OUTPUT_DIR / f"book{book_num}_combo.png"
    combo_enlarged.save(combo_path)
    
    # 10. Grayscale + kontrast (dla czytelności tekstu)
    gray = fragment.convert('L')
    gray_c = enhance_contrast(gray, 2.5)
    gray_c_enlarged = deskew_and_enlarge(gray_c, scale=4)
    gray_c_path = OUTPUT_DIR / f"book{book_num}_grayscale_contrast.png"
    gray_c_enlarged.save(gray_c_path)
    
    print(f"  Zapisano {len([p for p in OUTPUT_DIR.iterdir() if f'book{book_num}' in p.name])} plików")
    return fragment

def main():
    print("Ładowanie obrazu...")
    img = load_image()
    
    # Definicje książek do przetworzenia
    # Na podstawie analizy wizualnej zdjęcia
    books = [
        # (nr, x_start%, x_end%, y_start%, y_end%, opis)
        (2, 0.5, 4.5, 18, 82, "Wojna Balonowa - Romuald Pawlak"),
        (3, 4.5, 9.0, 18, 82, "Czarem i smoczym oddechem - Romuald Pawlak"),
        (21, 82, 87, 18, 82, "Cyn... - Philip Reeve"),
        (22, 87, 92, 18, 82, "Kosmos... - Neil deGrasse Tyson"),
        (23, 92, 100, 18, 82, "Osad.../Cat... - Rebecca..."),
    ]
    
    for book_num, x_start, x_end, y_start, y_end, desc in books:
        print(f"\n{'#'*60}")
        print(f"# Książka nr {book_num}: {desc}")
        print(f"{'#'*60}")
        process_book_fragment(img, book_num, x_start, x_end, y_start, y_end)
    
    # Generowanie podsumowania
    summary_path = OUTPUT_DIR / "processing_summary.txt"
    with open(summary_path, 'w', encoding='utf-8') as f:
        f.write("Podsumowanie przetwarzania obrazu\n")
        f.write("=" * 50 + "\n\n")
        f.write(f"Źródło: {IMAGE_PATH}\n")
        f.write(f"Wymiary: {img.size[0]}x{img.size[1]} px\n\n")
        f.write("Przetworzone książki:\n")
        for book_num, x_start, x_end, y_start, y_end, desc in books:
            files = [p.name for p in OUTPUT_DIR.iterdir() if f'book{book_num}' in p.name]
            f.write(f"  nr {book_num}: {desc}\n")
            f.write(f"    Pozycja: {x_start}-{x_end}% (szerokość)\n")
            f.write(f"    Pliki: {len(files)}\n")
            for fname in sorted(files):
                f.write(f"      - {fname}\n")
        f.write(f"\nCałkowita liczba plików: {len(list(OUTPUT_DIR.iterdir())) - 1}\n")
    
    print(f"\n\nPodsumowanie zapisano w: {summary_path}")
    print(f"Całkowita liczba wygenerowanych plików: {len(list(OUTPUT_DIR.iterdir())) - 1}")

if __name__ == "__main__":
    main()
