"""喵创说应用图标生成脚本

使用 Pillow 绘制浅蓝色渐变背景 + 白色 M 字母图标。
生成 Tauri 所需的全部图标尺寸 (PNG) 和 Windows ICO 文件。

输出文件:
  - icons/icon.png            (512x512, 主图标源)
  - icons/128x128@2x.png      (256x256)
  - icons/128x128.png         (128x128)
  - icons/32x32.png           (32x32)
  - icons/icon.ico            (多尺寸 ICO: 16/32/48/64/128/256)

设计规格:
  - 背景: 浅蓝色对角渐变 (#6EA8FE -> #4A7FE8)
  - 圆角: 18.75% (96/512)
  - M 字母: Arial Bold, 白色, 居中
  - 装饰: 右下角白色小圆点 (呼应 Logo 设计)
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

# ===== 设计参数 =====
# 浅蓝色渐变端点 (与 SVG 源一致)
COLOR_BG_TOP_LEFT = (110, 168, 254)    # #6EA8FE
COLOR_BG_BOTTOM_RIGHT = (74, 127, 232) # #4A7FE8
COLOR_M_TOP = (255, 255, 255)          # 白色
COLOR_M_BOTTOM = (232, 240, 255)       # 极浅蓝白
COLOR_DOT = (255, 255, 255)            # 装饰圆点

# 圆角比例 (半径/边长)
CORNER_RADIUS_RATIO = 96 / 512

# 字体路径 (Windows 自带 Arial Bold)
FONT_PATH = r"C:\Windows\Fonts\arialbd.ttf"

# 输出目录
ICONS_DIR = Path(__file__).parent


def draw_gradient_background(size: int) -> Image.Image:
    """绘制对角渐变背景 (左上 -> 右下)。

    输入: size 画布边长 (像素)
    输出: Image.Image 带渐变背景的 RGBA 图像
    流程: 逐像素计算对角线插值, 从 COLOR_BG_TOP_LEFT 过渡到 COLOR_BG_BOTTOM_RIGHT
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = img.load()
    for y in range(size):
        for x in range(size):
            # 对角线归一化坐标 (0~1)
            t = (x + y) / (2 * max(size - 1, 1))
            r = int(COLOR_BG_TOP_LEFT[0] + (COLOR_BG_BOTTOM_RIGHT[0] - COLOR_BG_TOP_LEFT[0]) * t)
            g = int(COLOR_BG_TOP_LEFT[1] + (COLOR_BG_BOTTOM_RIGHT[1] - COLOR_BG_TOP_LEFT[1]) * t)
            b = int(COLOR_BG_TOP_LEFT[2] + (COLOR_BG_BOTTOM_RIGHT[2] - COLOR_BG_TOP_LEFT[2]) * t)
            pixels[x, y] = (r, g, b, 255)
    return img


def apply_rounded_corners(img: Image.Image, radius: int) -> Image.Image:
    """为图像应用圆角遮罩。

    输入:
      img - 原始 RGBA 图像
      radius - 圆角半径 (像素)
    输出: Image.Image 圆角处理后的 RGBA 图像
    流程: 创建圆角矩形遮罩, 与原图合成
    """
    mask = Image.new("L", img.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (img.size[0] - 1, img.size[1] - 1)], radius=radius, fill=255)
    result = Image.new("RGBA", img.size, (0, 0, 0, 0))
    result.paste(img, (0, 0), mask)
    return result


def draw_m_letter(img: Image.Image, size: int) -> None:
    """在图像中央绘制 M 字母。

    输入:
      img - 目标 RGBA 图像 (就地修改)
      size - 画布边长 (像素)
    流程:
      1. 加载 Arial Bold 字体, 字号为画布的 62.5%
      2. 测量 M 字母尺寸, 居中定位
      3. 绘制 M 字母 (白色)
    """
    font_size = int(size * 0.625)
    try:
        font = ImageFont.truetype(FONT_PATH, font_size)
    except OSError:
        # 字体加载失败, 降级使用默认字体
        font = ImageFont.load_default()

    draw = ImageDraw.Draw(img)
    # 测量字母尺寸 (anchor="mm" 实现水平+垂直居中)
    # 使用 anchor="lm" 先测量, 再居中
    bbox = draw.textbbox((0, 0), "M", font=font, anchor="lt")
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    # 居中绘制 (略微上偏 2% 视觉补偿, 因为大写字母视觉重心略高)
    x = (size - text_w) / 2 - bbox[0]
    y = (size - text_h) / 2 - bbox[1] - int(size * 0.02)

    draw.text((x, y), "M", fill=COLOR_M_TOP, font=font)


def draw_decorative_dot(img: Image.Image, size: int) -> None:
    """在右下角绘制装饰小圆点。

    输入:
      img - 目标 RGBA 图像 (就地修改)
      size - 画布边长 (像素)
    流程: 在 (78%, 78%) 位置绘制半径为 3.125% 画布的白色圆点
    """
    draw = ImageDraw.Draw(img)
    cx, cy = int(size * 0.78), int(size * 0.78)
    r = max(int(size * 0.03125), 2)
    draw.ellipse([(cx - r, cy - r), (cx + r, cy + r)], fill=COLOR_DOT)


def render_icon(size: int) -> Image.Image:
    """渲染指定尺寸的完整图标。

    输入: size 边长 (像素)
    输出: Image.Image 完整的 RGBA 图标
    流程:
      1. 绘制渐变背景
      2. 应用圆角
      3. 绘制 M 字母
      4. 绘制装饰圆点 (尺寸 >= 64 时才绘制, 小尺寸会模糊)
    """
    img = draw_gradient_background(size)
    radius = int(size * CORNER_RADIUS_RATIO)
    img = apply_rounded_corners(img, radius)
    draw_m_letter(img, size)
    # 小尺寸 (32px) 不绘制圆点, 避免视觉杂乱
    if size >= 64:
        draw_decorative_dot(img, size)
    return img


def main() -> None:
    """主函数: 生成全部图标文件。"""
    print("开始生成喵创说应用图标...")

    # 生成各尺寸 PNG
    png_outputs = [
        (512, "icon.png"),
        (256, "128x128@2x.png"),
        (128, "128x128.png"),
        (32, "32x32.png"),
    ]

    for size, filename in png_outputs:
        img = render_icon(size)
        output_path = ICONS_DIR / filename
        img.save(output_path, "PNG")
        print(f"  已生成 {filename} ({size}x{size})")

    # 生成 ICO (多尺寸, Windows 自动选择最合适尺寸)
    # Pillow ICO 保存: 以最大尺寸图像为主图, sizes 参数指定全部包含尺寸
    # Pillow 会自动从主图缩放生成各尺寸
    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_master = render_icon(256)  # 用 256x256 作为主图, 保证缩放质量
    ico_path = ICONS_DIR / "icon.ico"
    ico_master.save(ico_path, format="ICO", sizes=ico_sizes)
    print(f"  已生成 icon.ico (包含尺寸: {[s[0] for s in ico_sizes]})")

    print("图标生成完成!")


if __name__ == "__main__":
    main()
