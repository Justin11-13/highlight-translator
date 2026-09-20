"""向当前 venv 安装 Argos 翻译语言包。

用法: python install_models.py en-zh zh-en
索引中找不到对应语言包或下载失败时，以非零退出码结束。
"""
import sys

import argostranslate.package as package

pairs = set()
for arg in sys.argv[1:]:
    src, _, dst = arg.partition('-')
    pairs.add((src, dst))

available = package.get_available_packages()
wanted = [p for p in available if (p.from_code, p.to_code) in pairs]

if not wanted:
    print('no matching packages in index for', sorted(pairs), file=sys.stderr)
    sys.exit(2)

for pkg in wanted:
    print('installing', pkg, flush=True)
    package.install_from_path(pkg.download())

installed = [f'{p.from_code}->{p.to_code}' for p in package.get_installed_packages()]
print('models installed:', installed, flush=True)
