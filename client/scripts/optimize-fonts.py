# -*- coding: utf-8 -*-
"""
optimize-fonts.py
Assets/Font 의 원본 폰트를 최적화한 woff2 로 다시 만들어 Assets/Font/optimized/ 에 넣는다.

왜 필요한가:
  NEXON Warhaven 은 무압축 TTF 3.2MB 짜리가 2종 있고, 이 프로젝트에서 가장 많이 쓰는
  표시용 폰트라 거의 모든 페이지에서 내려받는다. woff2 로만 바꿔도 90% 가 줄어든다.

두 가지 방식을 쓴다:
  - 전체 보존(subset=False): 글리프를 하나도 버리지 않고 woff2 재압축 + 힌팅 제거만 한다.
    방명록·갤러리처럼 사용자가 입력한 글자가 렌더링되는 폰트는 전부 이쪽이다.
    (NexonWarhaven / Hahmlet / Quentin / OldLondon)
  - 상용 서브셋(subset=True): Pretendard 는 이미 woff2 라 재압축 효과가 없어서
    (721KB → 721KB) 글자 수를 줄이는 것 말고는 방법이 없다. 대신 Pretendard 로
    렌더링되는 한글은 전부 레포 안 정적 텍스트뿐이고(사용자 입력은 NexonWarhaven/
    Hahmlet 이 받는다) 아래 COMMON 집합이 그 텍스트를 100% 포함하므로 안전하다.
    범위 밖 글자는 시스템 sans 로 대체된다.

COMMON(상용 집합) = Hahmlet 이 담고 있는 한글 음절 2,788자
                  ∪ 이 레포 소스에 실제로 등장하는 모든 문자
  Hahmlet 은 구글이 배포하는 한국어 서브셋 폰트라 그 음절 집합이 곧 "상용 한글"의
  검증된 정의다. 별도 표를 하드코딩하지 않으려고 이 집합을 그대로 빌려 쓴다.
  레포 텍스트를 합집합으로 넣는 이유는, 스토리 본문에 상용 밖 음절(엸/챱/춉 같은
  의성어)이 섞여 있어도 그 페이지가 통째로 대체 폰트로 떨어지지 않게 하기 위함이다.

사전 준비 (프로젝트 의존성이 아니라 로컬 빌드 도구):
  pip install fonttools brotli

사용법:
  cd client && python scripts/optimize-fonts.py
"""
import glob
import io
import os
import sys

from fontTools.ttLib import TTFont
from fontTools import subset

HERE = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.dirname(HERE)
FONT_DIR = os.path.join(CLIENT, 'src', 'Assets', 'Font')
OUT_DIR = os.path.join(FONT_DIR, 'optimized')

# 상용 집합의 근거가 되는 폰트. 바꾸려면 같은 성격(한국어 서브셋)인지 확인할 것.
COMMON_SOURCE = os.path.join(FONT_DIR, 'woff2', 'Hahmlet-Regular.woff2')

# (원본 경로, 결과 파일명, 상용 서브셋 여부)
TARGETS = [
    ('ttf/NEXON_Warhaven_Regular.ttf', 'NEXON_Warhaven_Regular.woff2', False),
    ('ttf/NEXON_Warhaven_Bold.ttf', 'NEXON_Warhaven_Bold.woff2', False),
    ('woff2/Hahmlet-Regular.woff2', 'Hahmlet-Regular.woff2', False),
    ('woff2/Hahmlet-Bold.woff2', 'Hahmlet-Bold.woff2', False),
    ('otf/Quentin.otf', 'Quentin.woff2', False),
    ('otf/OldLondon.otf', 'OldLondon.woff2', False),
    # Pretendard 는 실제로 쓰는 웨이트만 남긴다(본문 400 / 제목 600 / 강조 700 / MIHEARTI 800).
    ('woff2/Pretendard-Regular.woff2', 'Pretendard-Regular.woff2', True),
    ('woff2/Pretendard-SemiBold.woff2', 'Pretendard-SemiBold.woff2', True),
    ('woff2/Pretendard-Bold.woff2', 'Pretendard-Bold.woff2', True),
    ('woff2/Pretendard-ExtraBold.woff2', 'Pretendard-ExtraBold.woff2', True),
]

# 레포 텍스트를 훑을 범위. 정적 콘텐츠와 UI 문구가 모두 들어 있다.
TEXT_GLOBS = [
    'src/Data/**/*.js',
    'src/Pages/*.js',
    'src/Components/**/*.js',
    'src/Components/**/*.jsx',
    'src/Styles/*.css',
]


def build_common_set():
    if not os.path.exists(COMMON_SOURCE):
        sys.exit('상용 집합의 기준 폰트를 찾지 못했습니다: %s' % COMMON_SOURCE)
    cps = {c for c in TTFont(COMMON_SOURCE, lazy=True).getBestCmap() if 0xAC00 <= c <= 0xD7A3}

    text = ''
    for pattern in TEXT_GLOBS:
        for path in glob.glob(os.path.join(CLIENT, pattern), recursive=True):
            text += io.open(path, encoding='utf-8').read()
    cps |= {ord(ch) for ch in text}
    return cps


def kb(path):
    return os.path.getsize(path) / 1024.0


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    common = build_common_set()
    print('상용 집합 %d자 (Hahmlet 음절 + 레포 텍스트)\n' % len(common))

    before = after = 0.0
    for rel, out_name, do_subset in TARGETS:
        src = os.path.join(FONT_DIR, rel)
        if not os.path.exists(src):
            print('SKIP  %s — 원본 없음' % rel)
            continue
        out = os.path.join(OUT_DIR, out_name)

        args = [
            src,
            '--flavor=woff2',
            '--output-file=' + out,
            # 합자/커닝 등 조판 기능은 유지하고, 용량만 차지하는 힌팅은 버린다.
            '--layout-features=*',
            '--no-hinting',
            '--desubroutinize',
        ]
        if do_subset:
            keep = set(TTFont(src, lazy=True).getBestCmap()) & common
            args.append('--unicodes=' + ','.join('U+%04X' % c for c in sorted(keep)))
        else:
            args.append('--unicodes=*')
        subset.main(args)

        before += kb(src)
        after += kb(out)
        print('OK    %-32s %7.0f KB → %6.0f KB%s'
              % (rel, kb(src), kb(out), '  (상용 서브셋)' if do_subset else ''))

    print('\n합계  %.0f KB → %.0f KB  (-%.0f%%)' % (before, after, (1 - after / before) * 100))


if __name__ == '__main__':
    main()
