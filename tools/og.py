#!/usr/bin/env python3
r"""Картинка превью теста 1200×630 в стиле сайта: текст слева, фото в арке справа.

Пример:
  python3 tools/og.py --out otnosheniya/og.jpg --photo otnosheniya/photo.jpg \
      --badge "12 вопросов · 3 минуты" --title "Почему мне|трудно|доверять?" \
      --subtitle "Тест о близости и отношениях"

--title: строки через «|», не больше трёх; выводятся ЗАГЛАВНЫМИ. Кегль подбирается под ширину
(80 → 40); не влезает и на 40 — ошибка: разбей заголовок на строки иначе.
--subtitle — короткий (до ~35 знаков); не влезает — ошибка, длинную фразу оставь для og:description.
Цвета по умолчанию — как у главной (светлый фон, терракотовый акцент); у теста со своей
палитрой передай свои (#rgb, #rrggbb, rgb(...), названия цветов).
Сохраняет JPEG (--out *.jpg) — так превью весит < 300 КБ (WhatsApp больше не показывает).
"""
import argparse
import os
import sys

from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont, ImageOps

W, H = 1200, 630
TEXT_X, TEXT_MAX_W = 70, 640
PHOTO_W, PHOTO_H, PHOTO_RIGHT = 380, 570, 60

FONTS_BOLD = ['/usr/share/fonts/opentype/inter/Inter-Bold.otf',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']
FONTS_REG = ['/usr/share/fonts/opentype/inter/Inter-Regular.otf',
             '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']


def font(paths, size):
    for p in paths:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    sys.exit('Нет шрифта с кириллицей: ' + ', '.join(paths))


def rgb(c):
    try:
        return ImageColor.getrgb(c)[:3]
    except ValueError:
        sys.exit(f'Не понял цвет «{c}»: нужен #rrggbb, #rgb, rgb(...) или название')


def arch(photo_path):
    ph = ImageOps.exif_transpose(Image.open(photo_path)).convert('RGB')  # фото с телефона бывает повёрнуто в EXIF
    scale = max(PHOTO_W / ph.width, PHOTO_H / ph.height)
    ph = ph.resize((round(ph.width * scale), round(ph.height * scale)), Image.LANCZOS)
    left = (ph.width - PHOTO_W) // 2
    ph = ph.crop((left, 0, left + PHOTO_W, PHOTO_H))  # лицо обычно сверху — режем низ и бока
    mask = Image.new('L', (PHOTO_W, PHOTO_H), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, PHOTO_W, PHOTO_H + 200), radius=PHOTO_W // 2, fill=255)
    md.rectangle((0, PHOTO_H - 30, PHOTO_W, PHOTO_H), fill=0)
    md.rounded_rectangle((0, PHOTO_H - 90, PHOTO_W, PHOTO_H), radius=30, fill=255)
    return ph, mask


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--out', required=True)
    a.add_argument('--photo', help='фото автора; без него текст на всю ширину')
    a.add_argument('--badge', required=True, help='«15 вопросов · 3–5 минут»')
    a.add_argument('--title', required=True, help='строки через «|»')
    a.add_argument('--subtitle', default='')
    a.add_argument('--author', default='Анастасия Кофман · психология')
    a.add_argument('--bg', default='#fbf5ed', help='фон страницы (переменная --bg теста)')
    a.add_argument('--glow', default='#f5dfc6', help='второй цвет фона/градиента — мягкое пятно справа сверху')
    a.add_argument('--accent', default='#ba5220', help='акцент: заголовок и текст плашки')
    a.add_argument('--ink', default='#633e2b', help='основной цвет текста: подзаголовок')
    a.add_argument('--muted', default='#795a48', help='второстепенный текст: подпись автора')
    a.add_argument('--chip', default='#f4e1ce', help='фон плашки; нет плашки в тесте — фон карточки или кнопки ответа')
    a.add_argument('--line', default='#e7a06f', help='короткая линия под заголовком: приглушённый акцент или цвет рамки')
    o = a.parse_args()

    lines = [s.strip() for s in o.title.split('|') if s.strip()]
    if not 1 <= len(lines) <= 3:
        sys.exit('--title: от одной до трёх строк через «|»')
    max_w = TEXT_MAX_W if o.photo else W - 2 * TEXT_X

    img = Image.new('RGB', (W, H), rgb(o.bg))
    glow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(glow).ellipse((560, -420, 1640, 520), fill=255)
    img = Image.composite(Image.new('RGB', (W, H), rgb(o.glow)), img,
                          glow.filter(ImageFilter.GaussianBlur(120)))
    if o.photo:
        ph, mask = arch(o.photo)
        img.paste(ph, (W - PHOTO_W - PHOTO_RIGHT, (H - PHOTO_H) // 2), mask)
    d = ImageDraw.Draw(img)

    fb = font(FONTS_BOLD, 22)
    badge = o.badge.upper()
    bw = d.textlength(badge, font=fb)
    d.rounded_rectangle((TEXT_X, 70, TEXT_X + bw + 40, 116), radius=23, fill=rgb(o.chip))
    d.text((TEXT_X + 20, 93), badge, font=fb, fill=rgb(o.accent), anchor='lm')

    fits = lambda f: all(d.textlength(s.upper(), font=f) <= max_w for s in lines)
    size = 80
    while size > 40 and not fits(font(FONTS_BOLD, size)):
        size -= 2
    ft = font(FONTS_BOLD, size)
    if not fits(ft):
        sys.exit('Заголовок не влезает даже кеглем 40 — разбей его на строки иначе (через «|»)')
    step = round(size * 1.12)
    y = 150 + (3 - len(lines)) * step // 2
    for s in lines:
        d.text((TEXT_X, y), s.upper(), font=ft, fill=rgb(o.accent))
        y += step
    d.rounded_rectangle((TEXT_X, y + 22, TEXT_X + 58, y + 25), radius=2, fill=rgb(o.line))
    if o.subtitle:
        fs = 32
        while fs > 22 and d.textlength(o.subtitle, font=font(FONTS_REG, fs)) > max_w:
            fs -= 1
        if d.textlength(o.subtitle, font=font(FONTS_REG, fs)) > max_w:
            sys.exit('Подзаголовок не влезает — нужен короче (до ~35 знаков)')
        d.text((TEXT_X, y + 50), o.subtitle, font=font(FONTS_REG, fs), fill=rgb(o.ink))
    d.text((TEXT_X, y + 96), o.author, font=font(FONTS_REG, 26), fill=rgb(o.muted))

    os.makedirs(os.path.dirname(o.out) or '.', exist_ok=True)
    if o.out.lower().endswith(('.jpg', '.jpeg')):
        img.save(o.out, quality=88, optimize=True, progressive=True)
    else:
        img.save(o.out, optimize=True)
    kb = os.path.getsize(o.out) / 1024
    print(f'{o.out}: {W}×{H}, {kb:.0f} КБ, кегль заголовка {size}' + ('  ⚠️ больше 300 КБ' if kb > 300 else ''))


if __name__ == '__main__':
    main()
