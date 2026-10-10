"""Draw the extension's simple chat/search icon from geometry."""
from pathlib import Path
from PIL import Image, ImageDraw

destination = Path(__file__).resolve().parents[1] / 'extension' / 'icons'
destination.mkdir(exist_ok=True)
canvas = Image.new('RGBA', (512,512))
draw = ImageDraw.Draw(canvas)
draw.rounded_rectangle((8,8,504,504),radius=120,fill='#d93900')
draw.rounded_rectangle((105,112,401,344),radius=60,fill='white')
draw.polygon([(145,310),(145,408),(246,330)],fill='white')
draw.ellipse((178,161,289,272),outline='#d93900',width=20)
draw.line((272,255,327,310),fill='#d93900',width=22)
for size in (16,48,128):
    canvas.resize((size,size),Image.Resampling.LANCZOS).save(destination/f'{size}.png')
