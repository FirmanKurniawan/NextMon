"""Generates the NextMON logo SVGs (N monogram + signal arcs). Usage: python brand/gen-logo.py (run from repo root)."""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
def glyph(c, oa=.8):
    return (f'<g transform="translate(-4 3)" fill="none" stroke="{c}" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M18 46V20l22 26V26" stroke-width="5.6"/>'
            '<path d="M41.4 18.1A8 8 0 0 1 47.9 24.6" stroke-width="4.4"/>'
            f'<path d="M42.6 11.2A15 15 0 0 1 54.8 23.4" stroke-width="4.4" stroke-opacity="{oa}"/></g>')
DEFS = ('<defs><linearGradient id="nm-g" x1="0" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="#1aa9bf"/><stop offset="1" stop-color="#0a5b70"/></linearGradient>'
        '<linearGradient id="nm-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>')
TILE = ('<rect width="64" height="64" rx="16" fill="url(#nm-g)"/><rect width="64" height="34" rx="16" fill="url(#nm-s)"/>'
        '<rect x=".5" y=".5" width="63" height="63" rx="15.5" fill="none" stroke="#fff" stroke-opacity=".26"/>')
def w(name, s): open(os.path.join(HERE, name), 'w', encoding='utf8').write(s)
tile = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256"><title>NextMON</title>{DEFS}{TILE}{glyph("#fff")}</svg>\n'
w('mark.svg', tile); w('mark-tile.svg', tile)
w('mark-plain.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" color="#000"><title>NextMON</title>{glyph("currentColor")}</svg>\n')
w('logo.svg', f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 290 64" width="290" height="64"><title>NextMON</title>
  <svg x="0" y="0" width="64" height="64" viewBox="0 0 64 64">{DEFS}{TILE}{glyph("#fff")}</svg>
  <text x="80" y="43" font-family="Inter, 'Segoe UI', system-ui, -apple-system, Roboto, sans-serif" font-size="34" letter-spacing="-0.8"><tspan font-weight="500" fill="#0f2a33">Next</tspan><tspan font-weight="800" fill="#0e7490">MON</tspan></text>
</svg>
''')
print('brand svgs written')
