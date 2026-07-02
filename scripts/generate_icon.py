#!/usr/bin/env python3
"""
喵创说应用图标生成脚本
设计元素: 喵喵(猫脸) + 笔墨(钢笔笔尖)
配色: FANDEX 暗色主题(深蓝紫底 + 蓝紫渐变 + 青绿点缀)
输出: 1024x1024 PNG 源图, 供 tauri icon 命令生成各平台图标
"""
import math
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# ===== 背景圆角矩形 + 渐变 =====
# 暗色底: 深蓝紫 #0c0d14 → 略浅 #161823
radius = 180
for y in range(SIZE):
    ratio = y / SIZE
    r = int(12 + (22 - 12) * ratio)
    g = int(13 + (24 - 13) * ratio)
    b = int(20 + (35 - 20) * ratio)
    draw.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

# 圆角遮罩(裁切为圆角矩形)
mask = Image.new("L", (SIZE, SIZE), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=radius, fill=255)
img.putalpha(mask)

# ===== 猫脸轮廓(几何风格) =====
cx, cy = 512, 460  # 猫脸中心
face_w, face_h = 340, 300  # 猫脸宽高

# 猫耳(三角形, 渐变蓝紫)
ear_color = (124, 158, 255, 255)  # #7c9eff FANDEX primary
ear_shadow = (90, 120, 200, 255)

# 左耳
left_ear = [(cx - face_w // 2 - 30, cy - face_h // 2 + 40),
            (cx - face_w // 2 + 60, cy - face_h // 2 - 120),
            (cx - 40, cy - face_h // 2 + 20)]
draw.polygon(left_ear, fill=ear_color)

# 右耳
right_ear = [(cx + face_w // 2 + 30, cy - face_h // 2 + 40),
             (cx + face_w // 2 - 60, cy - face_h // 2 - 120),
             (cx + 40, cy - face_h // 2 + 20)]
draw.polygon(right_ear, fill=ear_color)

# 内耳(深色三角, 增加层次)
inner_ear_color = (180, 200, 255, 180)
left_inner = [(cx - face_w // 2 - 5, cy - face_h // 2 + 30),
              (cx - face_w // 2 + 45, cy - face_h // 2 - 70),
              (cx - 50, cy - face_h // 2 + 10)]
draw.polygon(left_inner, fill=inner_ear_color)

right_inner = [(cx + face_w // 2 + 5, cy - face_h // 2 + 30),
               (cx + face_w // 2 - 45, cy - face_h // 2 - 70),
               (cx + 50, cy - face_h // 2 + 10)]
draw.polygon(right_inner, fill=inner_ear_color)

# 猫脸主体(椭圆, 毛玻璃质感浅色)
face_color = (230, 235, 245, 240)
draw.ellipse([cx - face_w // 2, cy - face_h // 2,
              cx + face_w // 2, cy + face_h // 2], fill=face_color)

# ===== 猫脸五官 =====
# 眼睛(青绿色 #4ee6b0 FANDEX secondary, 椭圆)
eye_color = (78, 230, 176, 255)
eye_w, eye_h = 38, 52
eye_y = cy - 20
left_eye_x = cx - 80
right_eye_x = cx + 80

draw.ellipse([left_eye_x - eye_w // 2, eye_y - eye_h // 2,
              left_eye_x + eye_w // 2, eye_y + eye_h // 2], fill=eye_color)
draw.ellipse([right_eye_x - eye_w // 2, eye_y - eye_h // 2,
              right_eye_x + eye_w // 2, eye_y + eye_h // 2], fill=eye_color)

# 瞳孔(竖椭圆, 深色)
pupil_color = (20, 25, 35, 255)
pupil_w, pupil_h = 14, 36
draw.ellipse([left_eye_x - pupil_w // 2, eye_y - pupil_h // 2,
              left_eye_x + pupil_w // 2, eye_y + pupil_h // 2], fill=pupil_color)
draw.ellipse([right_eye_x - pupil_w // 2, eye_y - pupil_h // 2,
              right_eye_x + pupil_w // 2, eye_y + pupil_h // 2], fill=pupil_color)

# 眼睛高光(白色小圆点)
highlight = (255, 255, 255, 220)
draw.ellipse([left_eye_x - 3, eye_y - 15, left_eye_x + 5, eye_y - 7], fill=highlight)
draw.ellipse([right_eye_x - 3, eye_y - 15, right_eye_x + 5, eye_y - 7], fill=highlight)

# 鼻子(粉色倒三角)
nose_color = (255, 158, 122, 255)  # #ff9e7a FANDEX tertiary
nose = [(cx - 18, cy + 30), (cx + 18, cy + 30), (cx, cy + 55)]
draw.polygon(nose, fill=nose_color)

# 嘴(Y 形线条, 深色)
mouth_color = (60, 65, 80, 255)
mouth_y = cy + 55
# 嘴中线
draw.line([(cx, mouth_y), (cx, mouth_y + 20)], fill=mouth_color, width=4)
# 嘴左右弧线
draw.arc([cx - 30, mouth_y + 15, cx, mouth_y + 45], 200, 360, fill=mouth_color, width=4)
draw.arc([cx, mouth_y + 15, cx + 30, mouth_y + 45], 180, 340, fill=mouth_color, width=4)

# 胡须(细线, 左右各 3 根)
whisker_color = (100, 110, 130, 200)
whiskers = [
    # 左侧
    [(cx - 60, cy + 40), (cx - 160, cy + 25)],
    [(cx - 60, cy + 55), (cx - 165, cy + 55)],
    [(cx - 60, cy + 70), (cx - 160, cy + 85)],
    # 右侧
    [(cx + 60, cy + 40), (cx + 160, cy + 25)],
    [(cx + 60, cy + 55), (cx + 165, cy + 55)],
    [(cx + 60, cy + 70), (cx + 160, cy + 85)],
]
for w in whiskers:
    draw.line(w, fill=whisker_color, width=3)

# ===== 钢笔笔尖(右下角, 斜向穿插) =====
# 笔尖主体: 金属银色渐变三角形
pen_color = (200, 210, 230, 255)
pen_shadow = (140, 150, 170, 255)
pen_accent = (124, 158, 255, 255)  # 蓝紫装饰线

# 笔尖位置(右下角斜向)
pen_cx, pen_cy = 720, 760
pen_angle = -45  # 度数, 斜向右下

# 笔身(长矩形旋转)
pen_body_w, pen_body_h = 280, 50
body = Image.new("RGBA", (pen_body_w, pen_body_h), (0, 0, 0, 0))
body_draw = ImageDraw.Draw(body)
# 笔身渐变
for x in range(pen_body_w):
    ratio = x / pen_body_w
    r = int(180 + (220 - 180) * ratio)
    g = int(190 + (225 - 190) * ratio)
    b = int(210 + (235 - 210) * ratio)
    body_draw.line([(x, 0), (x, pen_body_h)], fill=(r, g, b, 255))

# 笔身中间蓝紫装饰线
body_draw.line([(0, pen_body_h // 2), (pen_body_w, pen_body_h // 2)],
               fill=pen_accent, width=4)

# 旋转笔身
body_rotated = body.rotate(pen_angle, expand=True, resample=Image.BICUBIC)
# 粘贴到主图
bx = pen_cx - body_rotated.width // 2
by = pen_cy - body_rotated.height // 2
img.paste(body_rotated, (bx, by), body_rotated)

# 笔尖(三角形, 银色)
nib_size = 70
nib = Image.new("RGBA", (nib_size, nib_size), (0, 0, 0, 0))
nib_draw = ImageDraw.Draw(nib)
# 笔尖三角
nib_draw.polygon([(nib_size // 2, 0), (0, nib_size), (nib_size, nib_size)],
                  fill=(220, 225, 240, 255))
# 笔尖中央缝隙(深色线)
nib_draw.line([(nib_size // 2, 10), (nib_size // 2, nib_size - 5)],
              fill=(40, 45, 55, 255), width=3)
# 笔尖顶部圆点(墨水滴)
nib_draw.ellipse([nib_size // 2 - 6, nib_size - 12, nib_size // 2 + 6, nib_size],
                  fill=(78, 230, 176, 255))  # 青绿墨水滴

nib_rotated = nib.rotate(pen_angle, expand=True, resample=Image.BICUBIC)
nx = pen_cx + 100 - nib_rotated.width // 2
ny = pen_cy + 100 - nib_rotated.height // 2
img.paste(nib_rotated, (nx, ny), nib_rotated)

# ===== 墨水溅射装饰(底部, 青绿色小点) =====
import random
random.seed(42)
ink_color = (78, 230, 176, 180)
ink_dots = [
    (380, 820, 8), (420, 850, 5), (350, 840, 4),
    (600, 830, 6), (650, 860, 4), (570, 845, 5),
    (470, 870, 3), (530, 825, 4),
]
for dx, dy, dr in ink_dots:
    draw.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=ink_color)

# ===== 整体微光晕(外发光) =====
glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
glow_draw.ellipse([cx - 250, cy - 200, cx + 250, cy + 200],
                   fill=(124, 158, 255, 30))
glow = glow.filter(ImageFilter.GaussianBlur(60))
# 合成光晕(在猫脸下方)
img = Image.alpha_composite(glow, img)

# ===== 保存 =====
output_path = r"c:\Atian\Project\Trae\project-writing\src-tauri\icons\icon_source.png"
img.save(output_path, "PNG")
print(f"Source icon saved: {output_path}")
print(f"Size: {img.size}")
