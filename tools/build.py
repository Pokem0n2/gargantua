#!/usr/bin/env python3
# ============================================================
# build.py — bundles GARGANTUA into a single self-contained
# gargantua.html that runs offline by double-click (file://).
#
# ES modules are blocked by CORS on file://, so everything is
# inlined into ONE <script type="module">:
#   vendor/three.module.js        (exports stripped)
#   vendor/addons/.../OrbitControls.js (imports/exports stripped)
#   const THREE = {...}           (namespace shim for app code)
#   js/core/*.js + js/shaders/*.js + js/main.js (imports stripped,
#                                                 `export ` stripped)
# CSS is inlined; ambient.wav becomes a base64 data URI.
#
# Usage: py tools/build.py   → gargantua.html
# ============================================================
import base64, re, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read(p):
    with open(os.path.join(ROOT, p), encoding='utf-8') as f:
        return f.read()

def strip_vendor_exports(code):
    """Remove consolidated `export { ... };` blocks (rollup output)."""
    code = re.sub(r'export\s*\{[^{}]*\}\s*;?', '', code)
    return code

def strip_imports(code):
    """Remove import statements incl. multi-line named imports."""
    return re.sub(r'^import\s[^;]*?from\s*[\'"][^\'"]*[\'"];?\s*$', '', code, flags=re.M | re.S)

def strip_export_kw(code):
    return re.sub(r'^export\s+', '', code, flags=re.M)

def check_no_module_syntax(code, name):
    for pat, what in [(r'\bimport\s+', 'import'), (r'^export\b', 'export')]:
        m = re.search(pat, code, flags=re.M)
        if m:
            i = m.start()
            raise SystemExit(f'FATAL: residual {what} in {name} near: {code[i:i+80]!r}')
    if '</script' in code.lower():
        raise SystemExit(f'FATAL: `</script` sequence found in {name}')

# ---------------- gather sources ----------------
html = read('tools/template.html')
css = read('css/style.css')

three = strip_vendor_exports(read('vendor/three.module.js'))
orbit = read('vendor/addons/controls/OrbitControls.js')
orbit = strip_export_kw(strip_imports(orbit))

app_files = [
    'js/core/params.js',
    'js/core/recovery.js',
    'js/core/audio.js',
    'js/core/camera.js',
    'js/shaders/blackhole.js',
    'js/shaders/post.js',
    'js/core/scene.js',
    'js/core/hud.js',
    'js/core/input.js',
    'js/main.js',
]
app_code_raw = '\n;\n'.join(strip_export_kw(strip_imports(read(p))) for p in app_files)

# ---------------- THREE namespace shim ----------------
symbols = sorted(set(re.findall(r'\bTHREE\.([A-Za-z_$][A-Za-z0-9_$]*)', app_code_raw)))
shim = 'const THREE = {' + ', '.join(symbols) + '};'

# ---------------- verify ----------------
check_no_module_syntax(three, 'three.module.js')
check_no_module_syntax(orbit, 'OrbitControls.js')

# merged single scope: deconflict top-level names from files appended after
# three.module.js (e.g. OrbitControls' own `_ray` collides with three's).
decl_re = re.compile(r'^(?:const|let|class|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)', re.M)
used = set(decl_re.findall(three))

def deconflict(code, used):
    rename = {}
    for n in sorted(set(decl_re.findall(code))):
        if n in used:
            nn = n + '_oc'
            while nn in used:
                nn += '_'
            rename[n] = nn
            used.add(nn)
    for old, new in rename.items():
        code = re.sub(r'\b' + re.escape(old) + r'\b', new, code)
    return code, sorted(rename)

orbit, orbit_renamed = deconflict(orbit, used)
used.update(decl_re.findall(orbit))

# app files are auto-deconflicted against vendor names (suffix _app);
# app-vs-app duplicate declarations still hard-fail (developer error)
owners = {}
app_code_parts = []
for p in app_files:
    code = strip_imports(strip_export_kw(read(p)))
    for name in decl_re.findall(code):
        if name in owners and owners[name] != p:
            raise SystemExit(f'FATAL: top-level `{name}` declared in both {owners[name]} and {p} — rename one')
        owners[name] = p
    code, _ren = deconflict(code, used)
    used.update(decl_re.findall(code))
    app_code_parts.append(code)

app_code = '\n;\n'.join(app_code_parts)

# ---------------- audio ----------------
# ambient.wav stays an EXTERNAL file (audio/ambient.wav): media elements may
# load relative file:// subresources on offline double-click, and this avoids
# multi-MB data URIs. (WebAudio routing is avoided too — see js/core/audio.js.)

# ---------------- assemble html ----------------
html = html.replace('<link rel="stylesheet" href="./css/style.css">',
                    '<style>\n' + css + '\n</style>')

# remove the import map block
html = re.sub(r'<script type="importmap">[\s\S]*?</script>\s*', '', html)

bundle = (
    # NOTE: three.module.js declares `class Audio` in the merged module scope,
    # putting the global DOM Audio into TDZ for the whole module — so the native
    # constructor must be captured in a separate CLASSIC script that runs first
    # (classic scripts execute before deferred module scripts).
    three + '\n' + orbit + '\n' + shim + '\n' + app_code
)
html = html.replace('<script type="module" src="./js/main.js"></script>',
    '<script>window.__NATIVE_AUDIO_CTOR = Audio;</script>\n'
    '<script type="module">\n' + bundle + '\n</script>')

out = os.path.join(ROOT, 'gargantua.html')
with open(out, 'w', encoding='utf-8', newline='\n') as f:
    f.write(html)

print(f'gargantua.html written: {os.path.getsize(out)/1024/1024:.2f} MiB, THREE shim: {len(symbols)} symbols')
