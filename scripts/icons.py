"""Draw the extension's Reddit Tweaks sliders icon from geometry."""
from pathlib import Path
from PIL import Image, ImageDraw

destination = Path(__file__).resolve().parents[1] / 'extension' / 'icons'
destination.mkdir(exist_ok=True)
canvas = Image.new('RGBA', (512,512))
draw = ImageDraw.Draw(canvas)
draw.rounded_rectangle((8,8,504,504),radius=120,fill='#ff4500')
# Sliders mark shared with the popup, legible at toolbar size.
for y, knob in ((170,310),(342,202)):
    draw.line((100,y,412,y),fill='white',width=28)
    draw.rounded_rectangle((knob-15,y-56,knob+15,y+56),radius=15,fill='white')
for size in (16,48,128):
    canvas.resize((size,size),Image.Resampling.LANCZOS).save(destination/f'{size}.png')
